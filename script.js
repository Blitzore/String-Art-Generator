document.addEventListener('DOMContentLoaded', () => {
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const cameraBtn = document.getElementById('cameraBtn');
    const cameraVideo = document.getElementById('cameraVideo');
    const cameraControls = document.getElementById('cameraControls');
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');
    
    const playbackControls = document.getElementById('playbackControls');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const restartBtn = document.getElementById('restartBtn');
    const skipBtn = document.getElementById('skipBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const recordBtn = document.getElementById('recordBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    
    const placeholderText = document.getElementById('placeholderText');
    const artCanvas = document.getElementById('artCanvas');
    const originalCanvas = document.getElementById('originalCanvas');
    
    const statusText = document.getElementById('statusText');
    const progressBarContainer = document.getElementById('progressBarContainer');
    const progressBar = document.getElementById('progressBar');

    const ctx = artCanvas.getContext('2d', { alpha: false });
    const origCtx = originalCanvas.getContext('2d', { willReadFrequently: true });

    let stream = null;
    let isAnimating = false;
    let animationId = null;
    let linesHistory = [];
    let currentLineIndex = 0;
    
    let isRecording = false;
    let mediaRecorder = null;
    let recordedChunks = [];
    
    // Auto Params
    const NUM_NAILS = 400; // higher angular resolution prevents blurring between multiple subjects
    const MAX_LINES = 8000; // proportional increase to match higher res
    const SIZE = 600; // higher computing precision perfectly isolates small detail lines like eyes
    const LINE_WEIGHT = 15; // increased weight to balance bolder opacity
    const LINE_OPACITY = 0.12; // restored high opacity for bolder/thicker visual look
    const MIN_NAIL_DISTANCE = 50; // slightly longer jump avoids edge clutter

    let nails = [];
    
    // UI Event Listeners
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
    
    cameraBtn.addEventListener('click', startCamera);
    captureBtn.addEventListener('click', captureCamera);
    cancelCameraBtn.addEventListener('click', stopCamera);
    
    playPauseBtn.addEventListener('click', togglePlayPause);
    restartBtn.addEventListener('click', restartAnimation);
    skipBtn.addEventListener('click', skipAnimation);
    downloadBtn.addEventListener('click', downloadImage);
    recordBtn.addEventListener('click', recordAnimation);

    function setStatus(text, progress = null) {
        statusText.textContent = text;
        if (progress !== null) {
            progressBarContainer.style.display = 'block';
            progressBar.style.width = `${progress * 100}%`;
        } else {
            progressBarContainer.style.display = 'none';
        }
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => processImage(img);
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    async function startCamera() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', aspectRatio: 1 } });
            cameraVideo.srcObject = stream;
            cameraVideo.style.display = 'block';
            cameraControls.style.display = 'flex';
            placeholderText.style.display = 'none';
            artCanvas.style.display = 'none';
            playbackControls.style.display = 'none';
            stopAnimation();
            setStatus('Position yourself and capture');
        } catch (err) {
            alert('Could not access camera: ' + err.message);
        }
    }

    function captureCamera() {
        if (!cameraVideo.videoWidth) return;
        const img = new Image();
        const canvas = document.createElement('canvas');
        canvas.width = cameraVideo.videoWidth;
        canvas.height = cameraVideo.videoHeight;
        const ctx2 = canvas.getContext('2d');
        // Mirror video
        ctx2.translate(canvas.width, 0);
        ctx2.scale(-1, 1);
        ctx2.drawImage(cameraVideo, 0, 0);
        
        img.onload = () => {
            stopCamera();
            processImage(img);
        };
        img.src = canvas.toDataURL('image/png');
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        cameraVideo.style.display = 'none';
        cameraControls.style.display = 'none';
    }

    function processImage(img) {
        placeholderText.style.display = 'none';
        artCanvas.style.display = 'block';
        playbackControls.style.display = 'none';
        stopAnimation();
        
        // Setup internal canvas
        originalCanvas.width = SIZE;
        originalCanvas.height = SIZE;
        
        // Crop square from center
        const sourceSize = Math.min(img.width, img.height);
        const x = (img.width - sourceSize) / 2;
        const y = (img.height - sourceSize) / 2;
        
        origCtx.fillStyle = '#ffffff'; // White out the background corners
        origCtx.fillRect(0, 0, SIZE, SIZE);
        
        // draw circular crop
        origCtx.beginPath();
        origCtx.arc(SIZE/2, SIZE/2, SIZE/2, 0, Math.PI * 2);
        origCtx.closePath();
        origCtx.clip();
        
        origCtx.drawImage(img, x, y, sourceSize, sourceSize, 0, 0, SIZE, SIZE);
        
        // Setup display canvas to look sharp on Retina
        const dpr = window.devicePixelRatio || 1;
        artCanvas.style.width = '100%';
        artCanvas.style.height = '100%';
        artCanvas.width = SIZE * dpr;
        artCanvas.height = SIZE * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
        ctx.scale(dpr, dpr);

        setStatus('Processing image...', 0);
        
        // Yield to allow UI update before heavy lifting
        setTimeout(() => computeStringArt(), 20);
    }

    function computeStringArt() {
        const imgData = origCtx.getImageData(0, 0, SIZE, SIZE);
        const data = imgData.data;
        const radius = SIZE / 2;
        
        // 1. Grayscale & Contrast
        // Normalize histograms locally inside the circle
        let minLuma = 255;
        let maxLuma = 0;
        const tempLuma = new Float32Array(SIZE * SIZE);

        for (let i = 0; i < tempLuma.length; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            tempLuma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
        }

        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                const dy = y - SIZE/2;
                const dx = x - SIZE/2;
                if (dx*dx + dy*dy <= radius*radius) {
                    const luma = tempLuma[y * SIZE + x];
                    if (luma < minLuma) minLuma = luma;
                    if (luma > maxLuma) maxLuma = luma;
                }
            }
        }

        const pixels = new Float32Array(SIZE * SIZE);
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                const i = y * SIZE + x;
                const dy = y - SIZE/2;
                const dx = x - SIZE/2;
                if (dx*dx + dy*dy <= radius*radius) {
                    let l = tempLuma[i];
                    let n = (maxLuma > minLuma) ? (l - minLuma) / (maxLuma - minLuma) : 0;
                    n = Math.pow(n, 1.5); // Greater contrast pulling ensures tiny details (like two distinct pairs of eyes) dictate string angles
                    n = 1.0 - n; // Invert for black string on white
                    // Linear mapping retains soft midtone gradients (cheeks, skin shading)
                    pixels[i] = n * 255;
                } else {
                    pixels[i] = 0;
                }
            }
        }

        // 2. Setup Nails (Circular boundary)
        nails = [];
        for (let i = 0; i < NUM_NAILS; i++) {
            const angle = (i / NUM_NAILS) * Math.PI * 2;
            nails.push({
                x: SIZE/2 + radius * Math.cos(angle) * 0.99,
                y: SIZE/2 + radius * Math.sin(angle) * 0.99
            });
        }

        // 3. Precompute line masks using Bresenham's logic
        setStatus('Precomputing paths...', 0.1);
        
        const lineCache = new Map();
        function getLinePixels(n1, n2) {
            if (n1 > n2) [n1, n2] = [n2, n1];
            const id = n1 * NUM_NAILS + n2;
            if (lineCache.has(id)) return lineCache.get(id);

            const p1 = nails[n1];
            const p2 = nails[n2];
            let x0 = Math.round(p1.x), y0 = Math.round(p1.y);
            const x1 = Math.round(p2.x), y1 = Math.round(p2.y);
            const dx = Math.abs(x1 - x0);
            const dy = Math.abs(y1 - y0);
            const sx = (x0 < x1) ? 1 : -1;
            const sy = (y0 < y1) ? 1 : -1;
            let err = dx - dy;

            const line = [];
            while(true) {
                if (x0 >= 0 && x0 < SIZE && y0 >= 0 && y0 < SIZE) {
                    line.push(y0 * SIZE + x0);
                }
                if (x0 === x1 && y0 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x0 += sx; }
                if (e2 < dx) { err += dx; y0 += sy; }
            }
            
            lineCache.set(id, line);
            return line;
        }

        // 4. Greedy String Drawing Algorithm
        linesHistory = [];
        let currentNail = 0;
        let lineCount = 0;
        
        function processChunk() {
            const CHUNK_SIZE = 60;
            let drawnThisChunk = 0;
            
            for(let c=0; c<CHUNK_SIZE && lineCount < MAX_LINES; c++) {
                let bestScore = -1;
                let bestNail = -1;
                let bestLine = null;

                for (let nextNail = 0; nextNail < NUM_NAILS; nextNail++) {
                    const dist = Math.abs(currentNail - nextNail);
                    const circularDist = Math.min(dist, NUM_NAILS - dist);
                    
                    if (circularDist < MIN_NAIL_DISTANCE) continue;

                    const line = getLinePixels(currentNail, nextNail);
                    
                    let score = 0;
                    for (let i = 0; i < line.length; i++) {
                        score += pixels[line[i]];
                    }
                    score /= (line.length + 1); // average brightness

                    if (score > bestScore) {
                        bestScore = score;
                        bestNail = nextNail;
                        bestLine = line;
                    }
                }

                if (bestNail !== -1 && bestScore > 2) {
                    linesHistory.push(bestNail);
                    for (let i = 0; i < bestLine.length; i++) {
                        pixels[bestLine[i]] = Math.max(0, pixels[bestLine[i]] - LINE_WEIGHT);
                    }
                    currentNail = bestNail;
                    lineCount++;
                    drawnThisChunk++;
                } else {
                    break;
                }
            }
            
            setStatus(`Generating pattern...`, 0.1 + (0.9 * lineCount / MAX_LINES));
            
            if (lineCount < MAX_LINES && drawnThisChunk > 0) {
                requestAnimationFrame(processChunk); // yields thread
            } else {
                finishProcessing();
            }
        }
        
        // start chunked processing
        requestAnimationFrame(processChunk);
    }

    function finishProcessing() {
        setStatus(`Generated ${linesHistory.length} lines.`, 1);
        setTimeout(() => setStatus('Ready'), 2000);
        playbackControls.style.display = 'flex';
        currentLineIndex = 0;
        clearCanvas();
        startAnimation();
    }

    function clearCanvas() {
        ctx.fillStyle = '#ffffff'; // White canvas
        ctx.fillRect(0, 0, SIZE, SIZE);
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(SIZE/2, SIZE/2, SIZE/2 - 1, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        nails.forEach(n => {
            ctx.beginPath();
            ctx.arc(n.x, n.y, 1, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    function startAnimation() {
        if (isAnimating) return;
        isAnimating = true;
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
        
        let previousNail = 0;
        if (currentLineIndex > 0) {
            previousNail = linesHistory[currentLineIndex - 1];
        } else {
            // we start at 0
            previousNail = 0;
        }

        function drawNext() {
            if (!isAnimating) return;
            
            const DRAW_SPEED = 4; // draw multiple lines per frame for speed
            
            for(let i=0; i<DRAW_SPEED; i++) {
                if (currentLineIndex >= linesHistory.length) {
                    isAnimating = false;
                    playIcon.style.display = 'block';
                    pauseIcon.style.display = 'none';
                    if (isRecording) {
                        setStatus('Holding final frame for 5 seconds...');
                        setTimeout(() => mediaRecorder.stop(), 5000); // 5 sec wait
                    }
                    return;
                }

                const nextNail = linesHistory[currentLineIndex];
                
                ctx.beginPath();
                ctx.moveTo(nails[previousNail].x, nails[previousNail].y);
                ctx.lineTo(nails[nextNail].x, nails[nextNail].y);
                ctx.strokeStyle = `rgba(0, 0, 0, ${LINE_OPACITY})`;
                ctx.lineWidth = 0.6;
                ctx.stroke();

                previousNail = nextNail;
                currentLineIndex++;
            }
            
            animationId = requestAnimationFrame(drawNext);
        }
        
        animationId = requestAnimationFrame(drawNext);
    }

    function stopAnimation() {
        isAnimating = false;
        if (animationId) cancelAnimationFrame(animationId);
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }

    function togglePlayPause() {
        if (isAnimating) {
            stopAnimation();
        } else {
            if (currentLineIndex >= linesHistory.length) {
                currentLineIndex = 0;
                clearCanvas();
            }
            startAnimation();
        }
    }

    function restartAnimation() {
        stopAnimation();
        currentLineIndex = 0;
        clearCanvas();
        startAnimation();
    }

    function skipAnimation() {
        if (!linesHistory.length) return;
        stopAnimation();
        
        let previousNail = currentLineIndex > 0 ? linesHistory[currentLineIndex - 1] : 0;
        ctx.strokeStyle = `rgba(0, 0, 0, ${LINE_OPACITY})`;
        ctx.lineWidth = 0.6;
        
        while (currentLineIndex < linesHistory.length) {
            const nextNail = linesHistory[currentLineIndex];
            ctx.beginPath();
            ctx.moveTo(nails[previousNail].x, nails[previousNail].y);
            ctx.lineTo(nails[nextNail].x, nails[nextNail].y);
            ctx.stroke();
            previousNail = nextNail;
            currentLineIndex++;
        }
        
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        setStatus('Animation finished');
        if (isRecording) {
            setStatus('Holding final frame for 5 seconds...');
            setTimeout(() => mediaRecorder.stop(), 5000);
        }
    }

    function downloadImage() {
        // Draw white background directly to exported image (since canvas might have transparent parts if not cleared carefully)
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = artCanvas.width;
        exportCanvas.height = artCanvas.height;
        const eCtx = exportCanvas.getContext('2d');
        eCtx.fillStyle = '#ffffff';
        eCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        eCtx.drawImage(artCanvas, 0, 0);

        const link = document.createElement('a');
        link.download = `string-art-${Date.now()}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    }

    function recordAnimation() {
        if (isRecording) return;
        if (!linesHistory.length) return;
        
        try {
            // Gunakan 30fps agar lebih stabil di perangkat mobile dan memori tidak bocor
            const stream = artCanvas.captureStream(30); 
            
            // Perbaikan khusus untuk browser mobile (terutama pengguna iPhone/iOS Safari)
            // dimana stream tidak mulai merekam kecuali frame di minta secara paksa:
            const track = stream.getVideoTracks()[0];
            if (track && typeof track.requestFrame === 'function') {
                track.requestFrame();
            }

            const format = document.getElementById('videoFormat').value;
            let options = {};
            
            if (format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) {
                options = { mimeType: 'video/mp4' };
            } else if (format === 'webm' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
                options = { mimeType: 'video/webm;codecs=vp9' };
            } else if (format === 'webm' && MediaRecorder.isTypeSupported('video/webm')) {
                options = { mimeType: 'video/webm' };
            } else {
                // Jangan paksaan opsi kalau tidak ada dukungan spesifik, biarkan default browser
                options = MediaRecorder.isTypeSupported('video/webm') ? { mimeType: 'video/webm' } : {};
            }
            
            mediaRecorder = new MediaRecorder(stream, options);
            
            mediaRecorder.ondataavailable = function(e) {
                if (e.data && e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                if (recordedChunks.length === 0) {
                    alert("Gagal merekam video. Tolong coba ubah format video ke WebM lalu unduh kembali, atau pastikan browser Anda aktif saat proses rekaman.");
                    isRecording = false;
                    recordBtn.style.color = '';
                    setStatus('Ready');
                    return;
                }
                
                const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || options.mimeType || 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                
                const mime = mediaRecorder.mimeType || options.mimeType || '';
                const ext = mime.includes('mp4') ? 'mp4' : 'webm';
                a.download = `string-art-video-${Date.now()}.${ext}`;
                document.body.appendChild(a);
                
                // Gunakan timeout kecil untuk memastikan event click diproses dengan baik di mobile
                setTimeout(() => {
                    a.click();
                    setTimeout(() => {
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                    }, 200);
                }, 100);
                
                recordedChunks = [];
                isRecording = false;
                recordBtn.style.color = '';
                
                // Restore UI
                document.querySelectorAll('.icon-btn, .primary-btn, .secondary-btn').forEach(b => b.style.pointerEvents = 'auto');
                setStatus('Video Downloaded Successfully!');
                setTimeout(() => setStatus('Ready'), 3000);
            };

            // Nonaktifkan interaksi tombol lain selama recording agar tidak terpotong
            document.querySelectorAll('.icon-btn:not(#recordBtn), .primary-btn, .secondary-btn').forEach(b => b.style.pointerEvents = 'none');
            
            recordBtn.style.color = '#ef4444'; 
            isRecording = true;
            recordedChunks = [];
            
            // Jangan menggunakan timeslice (misal start(1000)) karena ini menyebabkan crash/blank chunks di banyak perangkat HP/iOS Safari.
            // Biarkan browser mengumpulkan memori sepenuhnya untuk dirender di akhir (atau sampai batas memori).
            mediaRecorder.start();
            
            // Restart animation to capture from beginning
            stopAnimation();
            currentLineIndex = 0;
            clearCanvas();
            
            setStatus('RECORDING... PLEASE DO NOT CLOSE OR MINIMIZE BROWSER!');
            startAnimation();
        } catch (err) {
            alert("Video recording is not supported in your browser or an error occurred.");
            isRecording = false;
        }
    }
});
