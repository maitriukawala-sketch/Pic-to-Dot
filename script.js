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
    const minDim = 2000; // High res for smooth skeleton
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
        // -------------------------------------------------------------
        // 2. PREPARE BINARY MASK
        // -------------------------------------------------------------
        // -------------------------------------------------------------
        // 2. PREPARE BINARY MASK (Robust for Text)
        // -------------------------------------------------------------
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // Mild Blur: 3x3 is enough to remove noise but keeps text sharp
        cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

        // Adaptive Threshold: C=5 is more sensitive, catches faint text parts
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 5);

        // CRITICAL FIX: Dilate (Thicken) the ink first!
        // This closes tiny gaps in letters so the skeleton doesn't break.
        let kDilate = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        cv.dilate(binary, binary, kDilate); // Fatten lines to ensure connection
        kDilate.delete();

        // Morphological CLOSE: Final smoothing of the solid shapes
        cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kOpen);

        // -------------------------------------------------------------
        // 3. SKELETONIZATION (Force Single Line)
        // -------------------------------------------------------------
        // iteratively erode until lines are 1px thick (the "Skeleton")

        skel = new cv.Mat.zeros(binary.rows, binary.cols, cv.CV_8UC1);
        let done = false;

        while (!done) {
            cv.erode(binary, eroded, element);
            cv.dilate(eroded, temp, element);
            cv.subtract(binary, temp, temp);
            cv.bitwise_or(skel, temp, skel);
            eroded.copyTo(binary);

            let maxVal = cv.countNonZero(binary);
            if (maxVal === 0) done = true;
        }

        // -------------------------------------------------------------
        // 4. VECTORIZE & DRAW
        // -------------------------------------------------------------
        // Now we trace the 1px skeleton
        cv.findContours(skel, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        dottedCanvas.width = width;
        dottedCanvas.height = height;
        const ctx = dottedCanvas.getContext('2d');

        // White Paper
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // Styling: Standard "Little" Dots (Child-Friendly & Precise)
        // Back to finer dots for tracing precision
        const strokeWidth = Math.max(4, Math.round(width * 0.003));
        // Consistent, standard gap
        const gap = strokeWidth * 2.5;

        ctx.strokeStyle = '#000000';
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([0, gap]);

        let poly = new cv.Mat();

        for (let i = 0; i < contours.size(); ++i) {
            let contour = contours.get(i);

            // Filter noise
            if (cv.arcLength(contour, false) < 20) continue;

            // Smooth: Gentle smoothing (0.003) to keep shapes accurate but flowy
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

downloadBtn.addEventListener('click', function () {
    if (!dottedCanvas || dottedCanvas.width === 0) {
        alert("Please upload an image first!");
        return;
    }

    try {
        // Use toBlob for better performance and reliability with high-res images
        dottedCanvas.toBlob(function (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            // Simple, safe filename
            link.download = "TracingPage.png";
            link.href = url;

            // Append and click
            document.body.appendChild(link);
            link.click();

            // IMPORTANT: We do NOT revoke the URL immediately.
            // Revoking it too fast causes the download to FAIL or lose its name in Chrome.
            setTimeout(function () {
                if (link.parentNode) document.body.removeChild(link);
                // Wait 60 seconds before revoking to be absolutely safe
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            }, 2000);
        }, 'image/png');
    } catch (err) {
        console.error("Download failed:", err);
        // Fallback to simpler method if Blob fails
        const dataUrl = dottedCanvas.toDataURL("image/png");
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = "TracingPage.png";
        link.click();
    }
});
