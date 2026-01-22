let cvReady = false;

function onOpenCvReady() {
    cvReady = true;
    document.getElementById('loader').style.display = 'none';
    console.log('OpenCV.js is ready.');
}

const imageInput = document.getElementById('imageInput');
const previewContainer = document.getElementById('previewContainer');
const originalImage = document.getElementById('originalImage');
const dottedCanvas = document.getElementById('dottedCanvas');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const downloadBtn = document.getElementById('downloadBtn');

imageInput.addEventListener('change', (e) => {
    if (!cvReady) {
        alert('Please wait for the tools to load!');
        return;
    }
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            originalImage.src = event.target.result;
            originalImage.onload = () => {
                previewContainer.classList.remove('hidden');
                processImage(originalImage);
            };
        };
        reader.readAsDataURL(file);
    }
});

function processImage(imgElement) {
    if (!cvReady) return;

    // -------------------------------------------------------------
    // 1. SETUP: High-Res Canvas
    // -------------------------------------------------------------
    const minDim = 2000; // High res
    const scale = Math.max(1, minDim / Math.min(imgElement.naturalWidth, imgElement.naturalHeight));
    const width = Math.round(imgElement.naturalWidth * scale);
    const height = Math.round(imgElement.naturalHeight * scale);

    hiddenCanvas.width = width;
    hiddenCanvas.height = height;
    const ctxHidden = hiddenCanvas.getContext('2d');

    // Fill White
    ctxHidden.fillStyle = '#FFFFFF';
    ctxHidden.fillRect(0, 0, width, height);
    ctxHidden.drawImage(imgElement, 0, 0, width, height);

    let src = cv.imread(hiddenCanvas);
    let gray = new cv.Mat();
    let binary = new cv.Mat();
    let skel = new cv.Mat();
    let temp = new cv.Mat();
    let eroded = new cv.Mat();
    let element = cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3));
    let kOpen = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 5);

        let kDilate = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        cv.dilate(binary, binary, kDilate);
        kDilate.delete();

        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kOpen);

        skel = new cv.Mat.zeros(binary.rows, binary.cols, cv.CV_8UC1);
        let done = false;
        while (!done) {
            cv.erode(binary, eroded, element);
            cv.dilate(eroded, temp, element);
            cv.subtract(binary, temp, temp);
            cv.bitwise_or(skel, temp, skel);
            eroded.copyTo(binary);
            if (cv.countNonZero(binary) === 0) done = true;
        }

        cv.findContours(skel, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        dottedCanvas.width = width;
        dottedCanvas.height = height;
        const ctx = dottedCanvas.getContext('2d');

        // White Paper (Safety Check included)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        const strokeWidth = Math.max(4, Math.round(width * 0.003));
        const gap = strokeWidth * 2.5;

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([0, gap]);

        let poly = new cv.Mat();
        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);
            if (cv.arcLength(contour, false) < 20) continue;
            let perimeter = cv.arcLength(contour, true);
            cv.approxPolyDP(contour, poly, 0.003 * perimeter, false);

            if (poly.rows > 1) {
                ctx.beginPath();
                let p0 = poly.intPtr(0);
                ctx.moveTo(p0[0], p0[1]);
                for (let j = 1; j < poly.rows; ++j) {
                    let p = poly.intPtr(j);
                    ctx.lineTo(p[0], p[1]);
                }
                ctx.stroke();
            }
        }
        poly.delete();

        // Extra Safety: Ensure background is white for printing
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, dottedCanvas.width, dottedCanvas.height);
        ctx.globalCompositeOperation = "source-over";

    } catch (err) {
        console.error("Skeletonization Error:", err);
    } finally {
        if (src) src.delete();
        if (gray) gray.delete();
        if (binary) binary.delete();
        if (skel) skel.delete();
        if (temp) temp.delete();
        if (eroded) eroded.delete();
        if (element) element.delete();
        if (kOpen) kOpen.delete();
        if (contours) contours.delete();
        if (hierarchy) hierarchy.delete();
    }
}

// 🔧 COPY–PASTE FIX (Requested by USER)
downloadBtn.addEventListener("click", function () {
    dottedCanvas.toBlob(function (blob) {
        if (!blob) {
            alert("Canvas is empty. Please generate the tracing image first.");
            return;
        }

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "tracing-page.png"; // ✅ PNG enforced
        document.body.appendChild(a);
        a.click();

        // Safety delay for Chrome: don't revoke the URL until the browser starts the download
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 1000);
    }, "image/png");
});
