document.addEventListener('DOMContentLoaded', () => {
    // --- 辅助函数：生成时间戳 (格式: YYYYMMDD_HHMMSS) ---
    function getTimestamp() {
        const now = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }

    // --- 变量初始化 ---
    const fileInput = document.getElementById('target-images');
    const fileInfo = document.getElementById('target-images-info');
    const baseImageSelect = document.getElementById('base-image-select');
    
    const modeRadios = document.querySelectorAll('input[name="slice-mode"]');
    const settingsEven = document.getElementById('settings-even');
    const settingsCustom = document.getElementById('settings-custom');
    
    const editorWrapper = document.getElementById('editor-wrapper');
    const editorImg = document.getElementById('editor-img');
    const linesContainer = document.getElementById('lines-container');
    const addLineBtn = document.getElementById('add-line-btn');
    const removeLineBtn = document.getElementById('remove-line-btn');
    
    const generateBtn = document.getElementById('generate-btn');
    const progressWrapper = document.getElementById('progress-wrapper');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    const resultSection = document.getElementById('result-section');
    const previewContainer = document.getElementById('preview-container');
    const downloadAllBtn = document.getElementById('download-all-btn');

    let uploadedImages = []; 
    let customLines = []; 
    let isDragging = false;
    let currentDragLine = null;
    let generatedGifs = []; 
    let workerBlobUrl = null; // 用于存放 Worker 的本地 URL

    // --- 突破跨域限制：自动将 CDN 的 Worker 转为本地 Blob URL ---
    fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js')
        .then(res => res.blob())
        .then(blob => {
            workerBlobUrl = URL.createObjectURL(blob);
            generateBtn.disabled = false;
            generateBtn.textContent = '生成动图切片';
        })
        .catch(err => {
            console.error('Worker 加载失败:', err);
            generateBtn.textContent = '网络错误：无法加载生成引擎';
        });

    // --- 事件监听：模式切换 ---
    modeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'even') {
                settingsEven.classList.add('active');
                settingsCustom.classList.remove('active');
            } else {
                settingsEven.classList.remove('active');
                settingsCustom.classList.add('active');
                updateEditorImage();
            }
        });
    });

    // --- 事件监听：图片上传 ---
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        fileInfo.textContent = `已选择 ${files.length} 张图片`;
        uploadedImages = [];
        baseImageSelect.innerHTML = '';
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const img = await loadImageAsDataUrl(file);
            uploadedImages.push({ name: file.name, img: img });
            
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `图 ${i + 1}: ${file.name}`;
            baseImageSelect.appendChild(option);
        }
        
        updateEditorImage();
    });

    baseImageSelect.addEventListener('change', updateEditorImage);

    function loadImageAsDataUrl(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // --- 编辑器：更新基准图预览 ---
    function updateEditorImage() {
        if (uploadedImages.length === 0) return;
        const selectedIdx = baseImageSelect.value;
        const baseImg = uploadedImages[selectedIdx].img;
        
        editorImg.src = baseImg.src;
        editorImg.style.display = 'block';
        
        if (customLines.length === 0) {
            customLines = [0.5]; 
        }
        renderLines();
    }

    // --- 变量替换 ---
    let selectedLineIndex = null; // 记录当前被选中的切割线索引
    let isWrapperActive = false;  // 记录是否在图片区域内按下/触摸

    // --- 编辑器：添加与删除线条增强 ---
    addLineBtn.addEventListener('click', () => {
        if (customLines.length > 0) {
            const lastLine = Math.max(...customLines);
            customLines.push(lastLine + (1 - lastLine) / 2);
        } else {
            customLines.push(0.5);
        }
        selectedLineIndex = customLines.length - 1; // 自动选中新加的线
        renderLines();
    });

    removeLineBtn.addEventListener('click', () => {
        if (selectedLineIndex !== null) {
            // 删除当前被选中的那条切割线
            customLines.splice(selectedLineIndex, 1);
            selectedLineIndex = null; // 删除后清空选中状态
            renderLines();
        } else {
            // 如果用户没选中线就点了删除，给个小提示
            alert('请先在图片上单击选中一条需要删除的切割线（选中后会变成蓝色）。');
        }
    });

    // --- 渲染逻辑 ---
    function renderLines() {
        linesContainer.innerHTML = '';
        customLines.forEach((pos, index) => {
            const line = document.createElement('div');
            // 如果是当前选中的线，加上 active 类
            line.className = `slice-line ${index === selectedLineIndex ? 'active' : ''}`;
            line.style.top = `${pos * 100}%`;
            line.dataset.index = index;
            
            // 点击或触摸线条时：选中该线条
            const selectLine = (e) => {
                e.preventDefault();
                e.stopPropagation(); // 关键：阻止事件冒泡到底部图片容器，防止触发瞬移
                selectedLineIndex = index;
                renderLines(); 
            };

            line.addEventListener('mousedown', selectLine);
            line.addEventListener('touchstart', selectLine, { passive: false });

            linesContainer.appendChild(line);
        });
    }

    // --- 核心：提取通用移动逻辑，直接操作 DOM 提升丝滑度 ---
    function moveSelectedLineTo(clientY) {
        if (selectedLineIndex === null) return;
        
        const rect = editorWrapper.getBoundingClientRect();
        let yPos = clientY - rect.top;
        yPos = Math.max(0, Math.min(yPos, rect.height)); // 限制在线框内
        
        customLines[selectedLineIndex] = yPos / rect.height;
        
        // 直接更新 DOM 元素的 top 值，避免频繁触发 renderLines 导致卡顿
        const lineEl = linesContainer.children[selectedLineIndex];
        if (lineEl) {
            lineEl.style.top = `${customLines[selectedLineIndex] * 100}%`;
        }
    }

    // --- 代理拖拽 (Proxy Dragging)：在图片容器上滑动控制选中的线 ---
    // 鼠标事件
    editorWrapper.addEventListener('mousedown', (e) => {
        if (selectedLineIndex !== null) {
            isWrapperActive = true;
            moveSelectedLineTo(e.clientY); // 点击瞬间线直接瞬移过来
        }
    });
    document.addEventListener('mousemove', (e) => {
        if (isWrapperActive) moveSelectedLineTo(e.clientY);
    });
    document.addEventListener('mouseup', () => {
        isWrapperActive = false;
    });

    // 触摸事件
    editorWrapper.addEventListener('touchstart', (e) => {
        if (selectedLineIndex !== null) {
            isWrapperActive = true;
            moveSelectedLineTo(e.touches[0].clientY);
        }
    }, { passive: false });
    
    editorWrapper.addEventListener('touchmove', (e) => {
        if (isWrapperActive && selectedLineIndex !== null) {
            e.preventDefault(); // 关键：滑动图片控制线条时，彻底切断页面本体的上下滚动
            moveSelectedLineTo(e.touches[0].clientY);
        }
    }, { passive: false });

    editorWrapper.addEventListener('touchend', () => {
        isWrapperActive = false;
    });

    // --- 点击图片外部区域时：取消线条选中 ---
    const deselectLine = (e) => {
        // 如果点击的不是图片容器，且不是控制按钮，就取消选中
        if (!editorWrapper.contains(e.target) && !e.target.closest('.secondary-btn') && selectedLineIndex !== null) {
            selectedLineIndex = null;
            renderLines();
        }
    };
    document.addEventListener('mousedown', deselectLine);
    document.addEventListener('touchstart', deselectLine, { passive: false });

    // --- 核心：图片缩放裁剪，已修复 Canvas 警告 ---
    function drawScaledAndCentered(img, targetW, targetH, sliceY, sliceH) {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = sliceH;
        // 修复警告 1
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const scale = Math.max(targetW / img.width, targetH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        
        const dx = (targetW - drawW) / 2;
        const dy = (targetH - drawH) / 2;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = targetW;
        tempCanvas.height = targetH;
        // 修复警告 2
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCtx.drawImage(img, dx, dy, drawW, drawH);

        ctx.drawImage(tempCanvas, 0, sliceY, targetW, sliceH, 0, 0, targetW, sliceH);
        return canvas;
    }

    // --- 核心：生成动图切片 ---
    generateBtn.addEventListener('click', async () => {
        if (uploadedImages.length === 0) {
            alert('请先上传图片！');
            return;
        }

        const mode = document.querySelector('input[name="slice-mode"]:checked').value;
        const baseIdx = baseImageSelect.value;
        const baseImg = uploadedImages[baseIdx].img;
        const fps = parseInt(document.getElementById('fps-input').value) || 10;
        const delay = 1000 / fps;

        const targetW = baseImg.width;
        const targetH = baseImg.height;

        const batchTimestamp = getTimestamp();

        let slicesY = []; 

        if (mode === 'even') {
            const count = parseInt(document.getElementById('even-slices').value) || 3;
            for (let i = 0; i < count; i++) {
                slicesY.push({ start: i / count, end: (i + 1) / count });
            }
        } else {
            let sortedLines = [0, ...customLines, 1].sort((a, b) => a - b);
            for (let i = 0; i < sortedLines.length - 1; i++) {
                if (sortedLines[i] !== sortedLines[i+1]) { 
                    slicesY.push({ start: sortedLines[i], end: sortedLines[i+1] });
                }
            }
        }

        generateBtn.disabled = true;
        generateBtn.textContent = '生成中，请不要关闭页面...';
        progressWrapper.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        previewContainer.innerHTML = '';
        generatedGifs = [];
        resultSection.style.display = 'block';

        try {
            for (let i = 0; i < slicesY.length; i++) {
                const sliceY = Math.round(slicesY[i].start * targetH);
                const sliceH = Math.round((slicesY[i].end - slicesY[i].start) * targetH);
                
                if (sliceH < 1) continue;

                const gif = new GIF({
                    workers: 2,
                    quality: 10,
                    workerScript: workerBlobUrl, // 使用刚刚生成的 Blob URL
                    width: targetW,
                    height: sliceH
                });

                // 监听单一切片进度并更新全局进度条
                gif.on('progress', function(p) {
                    const overallProgress = ((i + p) / slicesY.length) * 100;
                    progressBar.style.width = `${overallProgress}%`;
                    progressText.textContent = `${Math.round(overallProgress)}%`;
                });

                for (let j = 0; j < uploadedImages.length; j++) {
                    const frameCanvas = drawScaledAndCentered(uploadedImages[j].img, targetW, targetH, sliceY, sliceH);
                    gif.addFrame(frameCanvas, { delay: delay });
                }

                const gifBlob = await new Promise((resolve) => {
                    gif.on('finished', (blob) => resolve(blob));
                    gif.render();
                });

                generatedGifs.push({ name: `slice_${batchTimestamp}_${i + 1}.gif`, blob: gifBlob });

                const url = URL.createObjectURL(gifBlob);
                const item = document.createElement('div');
                item.className = 'preview-item';
                item.innerHTML = `
                    <img src="${url}" alt="切片 ${i + 1}">
                    <span>切片 ${i + 1}</span>
                `;
                previewContainer.appendChild(item);
            }
            
            generateBtn.textContent = '生成完毕';
            progressBar.style.width = '100%';
            progressText.textContent = '100%';
        } catch (error) {
            console.error(error);
            alert('生成时出错，请检查控制台。');
        } finally {
            generateBtn.disabled = false;
            setTimeout(() => { 
                generateBtn.textContent = '生成动图切片'; 
                progressWrapper.style.display = 'none';
            }, 3000);
        }
    });

    // --- 批量下载 ---
    downloadAllBtn.addEventListener('click', () => {
        if (generatedGifs.length === 0) return;
        
        const zip = new JSZip();
        generatedGifs.forEach(gifData => {
            zip.file(gifData.name, gifData.blob);
        });

        zip.generateAsync({ type: 'blob' }).then(content => {
            const link = document.createElement('a');
            const downloadTimestamp = getTimestamp();
            link.href = URL.createObjectURL(content);
            link.download = `GIF_Slices_${downloadTimestamp}.zip`;
            link.click();
        });
    });
});