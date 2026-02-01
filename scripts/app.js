window.addEventListener('load', () => { if (typeof lucide !== 'undefined') lucide.createIcons(); });

const fileInput = document.getElementById('fileInput');
const engineSelect = document.getElementById('engineSelect');
const modeDesc = document.getElementById('modeDesc');
const srcCanvas = document.getElementById('srcCanvas');
const destCanvas = document.getElementById('destCanvas');
const srcContainer = document.getElementById('srcContainer');
const destContainer = document.getElementById('destContainer');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const reUploadBtn = document.getElementById('reUploadBtn');
const uploadWrapper = document.getElementById('uploadWrapper');
const processWrapper = document.getElementById('processWrapper');
const previewWrapper = document.getElementById('previewWrapper');
const statusToast = document.getElementById('statusToast');
const statusText = document.getElementById('statusText');
const loadingSpinner = document.getElementById('loadingSpinner');
const successIcon = document.getElementById('successIcon');

const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
const destCtx = destCanvas.getContext('2d');

let originalImageData = null;
let toastTimeout = null;

let isSyncing = false;
const sync = (s, d) => {
    s.addEventListener('scroll', () => {
        if (!isSyncing) {
            isSyncing = true;
            d.scrollTop = s.scrollTop;
            d.scrollLeft = s.scrollLeft;
            requestAnimationFrame(() => isSyncing = false);
        }
    });
};
sync(srcContainer, destContainer);
sync(destContainer, srcContainer);

document.getElementById('dropZone').onclick = () => fileInput.click();
reUploadBtn.onclick = () => fileInput.click();

engineSelect.onchange = () => {
    if (engineSelect.value === 'gemini_sparkle') {
        if (modeDesc) modeDesc.textContent = "當前模式：針對右下角白色菱型星星進行反轉補償。";
    } else {
        if (modeDesc) modeDesc.textContent = "當前模式：使用高精準度範圍鎖定，僅修復最底端浮水印，徹底避開主體邊緣。";
    }
};

fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            srcCanvas.width = destCanvas.width = img.width;
            srcCanvas.height = destCanvas.height = img.height;
            srcCtx.drawImage(img, 0, 0);
            originalImageData = srcCtx.getImageData(0, 0, img.width, img.height);
            destCtx.putImageData(originalImageData, 0, 0);
            uploadWrapper.classList.add('hidden');
            processWrapper.classList.remove('hidden');
            previewWrapper.classList.remove('hidden');
            document.getElementById('actionButtons').classList.remove('opacity-0', 'pointer-events-none');
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
};

processBtn.onclick = () => {
    if (!originalImageData) return;
    const mode = engineSelect.value;
    showStatus(mode === 'gemini_sparkle' ? "處理中..." : "精確定位修復中...", true);

    setTimeout(() => {
        const width = srcCanvas.width;
        const height = srcCanvas.height;
        const srcData = originalImageData.data;
        const output = destCtx.createImageData(width, height);
        const outData = output.data;

        if (mode === 'notebooklm_precision') {
            const scanStartX = Math.floor(width * 0.85);
            const zoneStart = Math.floor(height * 0.96);
            const zoneFull = Math.floor(height * 0.98);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    if (x < scanStartX || y < zoneStart) { copyPixel(outData, srcData, i); continue; }
                    const r = srcData[i], g = srcData[i+1], b = srcData[i+2], a = srcData[i+3];
                    const currentL = (r + g + b) / 3;
                    const maxDiff = Math.max(Math.abs(r-g), Math.abs(g-b), Math.abs(b-r));
                    let isTarget = (currentL < 225 && maxDiff < 15);
                    if (isTarget) {
                        let weight = (y >= zoneFull) ? 1.0 : (y - zoneStart) / (zoneFull - zoneStart);
                        performPrecisionRestoration(outData, srcData, x, y, width, height, i, a, weight);
                    } else {
                        copyPixel(outData, srcData, i);
                    }
                }
            }
        } else {
            const scanStartX = Math.floor(width * 0.72);
            const scanStartY = Math.floor(height * 0.75);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    const r = srcData[i], g = srcData[i+1], b = srcData[i+2], a = srcData[i+3];
                    const isInCorner = (x > scanStartX && y > scanStartY);
                    if (isInCorner && (r+g+b)/3 > 135) {
                        const alpha = (r+g+b)/3 > 210 ? 0.62 : 0.48;
                        const d = 1 - alpha;
                        outData[i]   = Math.min(255, Math.max(0, (r - 255 * alpha) / d));
                        outData[i+1] = Math.min(255, Math.max(0, (g - 255 * alpha) / d));
                        outData[i+2] = Math.min(255, Math.max(0, (b - 255 * alpha) / d));
                        outData[i+3] = a;
                    } else {
                        copyPixel(outData, srcData, i);
                    }
                }
            }
        }

        destCtx.putImageData(output, 0, 0);
        showStatus("精確修復完成。", false);
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => hideStatus(), 3000);
    }, 100);
};

function performPrecisionRestoration(outData, srcData, x, y, width, height, i, a, weight) {
    let bestR = 255, bestG = 255, bestB = 255;
    let found = false;
    const searchOffsetsY = [25, 40, 55, 15];
    const searchOffsetsX = [0, -1, 1];

    for (let oy of searchOffsetsY) {
        for (let ox of searchOffsetsX) {
            const ry = y - oy;
            const rx = x + ox;
            if (ry < 0 || rx < 0 || rx >= width) continue;
            const ti = (ry * width + rx) * 4;
            const tr = srcData[ti], tg = srcData[ti+1], tb = srcData[ti+2];
            const tL = (tr + tg + tb) / 3;
            const tDiff = Math.max(Math.abs(tr-tg), Math.abs(tg-tb), Math.abs(tb-tr));
            if (tL > 235 && tDiff < 8) { bestR = tr; bestG = tg; bestB = tb; found = true; break; }
        }
        if (found) break;
    }

    if (found) {
        const origR = srcData[i], origG = srcData[i+1], origB = srcData[i+2];
        const origL = Math.max(1, (origR + origG + origB) / 3);
        const targetL = (bestR + bestG + bestB) / 3;
        const gain = Math.min(4.0, targetL / origL);
        const rRatio = origR / origL;
        const gRatio = origG / origL;
        const bRatio = origB / origL;
        const restoredR = Math.min(255, targetL * rRatio);
        const restoredG = Math.min(255, targetL * gRatio);
        const restoredB = Math.min(255, targetL * bRatio);
        const finalR = (bestR * weight) + (restoredR * (1 - weight));
        const finalG = (bestG * weight) + (restoredG * (1 - weight));
        const finalB = (bestB * weight) + (restoredB * (1 - weight));
        outData[i]   = (finalR * weight) + (srcData[i] * (1 - weight));
        outData[i+1] = (finalG * weight) + (srcData[i+1] * (1 - weight));
        outData[i+2] = (finalB * weight) + (srcData[i+2] * (1 - weight));
        outData[i+3] = a;
    } else {
        if (weight > 0.9) {
            outData[i] = 254; outData[i+1] = 254; outData[i+2] = 254; outData[i+3] = a;
        } else {
            copyPixel(outData, srcData, i);
        }
    }
}

function copyPixel(target, source, i) { target[i] = source[i]; target[i+1] = source[i+1]; target[i+2] = source[i+2]; target[i+3] = source[i+3]; }

function showStatus(text, isLoading) {
    statusText.textContent = text;
    if (isLoading) { loadingSpinner.classList.remove('hidden'); successIcon.classList.add('hidden'); }
    else { loadingSpinner.classList.add('hidden'); successIcon.classList.remove('hidden'); }
    statusToast.classList.replace('translate-y-20', 'translate-y-0');
    statusToast.classList.replace('opacity-0', 'opacity-100');
}

function hideStatus() {
    statusToast.classList.replace('translate-y-0', 'translate-y-20');
    statusToast.classList.replace('opacity-100', 'opacity-0');
}

downloadBtn.onclick = () => {
    const link = document.createElement('a');
    link.download = `Precision_Restored_${Date.now()}.png`;
    link.href = destCanvas.toDataURL('image/png');
    link.click();
};
