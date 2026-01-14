class ImageViewer {
    constructor() {
        this.images = [];
        this.currentIndex = 0;
        this.zoomScale = 1;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.scrollLeft = 0;
        this.scrollTop = 0;

        // CT imaging components
        this.fileParser = new FileParser();
        this.ctViewer = null;
        this.currentMode = 'standard'; // 'standard' or 'ct'

        // 2D ROI state
        this.roiMode2D = false;
        this.roiSelecting2D = false;
        this.roiStart2D = { x: 0, y: 0 };
        this.roiEnd2D = { x: 0, y: 0 };
        this.roiCanvas2D = null;

        // Current TIFF data for uint16 grayscale support
        this.currentTiffData = null;

        this.initElements();
        this.initEventListeners();
        this.initCTComponents();
    }

    initElements() {
        // Standard 2D view elements
        this.mainImage = document.getElementById('mainImage');
        this.placeholder = document.getElementById('placeholder');
        this.fileInput = document.getElementById('fileInput');
        this.dropZone = document.getElementById('dropZone');
        this.thumbnailsContainer = document.getElementById('thumbnails');
        this.fileName = document.getElementById('fileName');
        this.imageInfo = document.getElementById('imageInfo');
        this.zoomLevel = document.getElementById('zoomLevel');
        this.imageWrapper = document.querySelector('.image-wrapper');

        // CT view elements
        this.standard2DView = document.getElementById('standard2DView');
        this.ct3DView = document.getElementById('ct3DView');
        this.ctControls = document.getElementById('ctControls');
        this.contrastSlider = document.getElementById('contrastSlider');
        this.contrastValue = document.getElementById('contrastValue');
        this.brightnessSlider = document.getElementById('brightnessSlider');
        this.brightnessValue = document.getElementById('brightnessValue');
        this.sliceIndicatorXY = document.getElementById('sliceIndicatorXY');
        this.sliceIndicatorXZ = document.getElementById('sliceIndicatorXZ');
        this.sliceIndicatorYZ = document.getElementById('sliceIndicatorYZ');
        this.pixelInfoGroup = document.getElementById('pixelInfoGroup');
        this.pixelInfo = document.getElementById('pixelInfo');

        // Canvas elements for medical view
        this.canvasXY = document.getElementById('canvasXY');
        this.canvasXZ = document.getElementById('canvasXZ');
        this.canvasYZ = document.getElementById('canvasYZ');
    }

    initEventListeners() {
        // Button events
        document.getElementById('openBtn').addEventListener('click', () => this.fileInput.click());
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoom(0.2));
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoom(-0.2));
        document.getElementById('resetBtn').addEventListener('click', () => this.resetView());
        document.getElementById('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('roiBtn').addEventListener('click', () => this.toggleRoiMode());
        document.getElementById('crosshairBtn').addEventListener('click', () => this.toggleCrosshairs());

        // File input
        this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        // Drag and drop
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Image dragging for panning (or ROI selection in ROI mode)
        this.mainImage.addEventListener('mousedown', (e) => this.handleImageMouseDown(e));
        this.mainImage.addEventListener('mousemove', (e) => this.handleImageMouseMove(e));
        this.mainImage.addEventListener('mouseup', (e) => this.handleImageMouseUp(e));
        this.mainImage.addEventListener('mouseleave', (e) => this.handleImageMouseUp(e));

        // Keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Mouse wheel zoom
        this.imageWrapper.addEventListener('wheel', (e) => this.handleWheel(e));

        // Image load event
        this.mainImage.addEventListener('load', () => this.updateImageInfo());
    }

    async handleFiles(files) {
        try {
            // Group files by type (pairs .raw with .json, etc.)
            const fileGroups = this.fileParser.groupFiles(files);

            if (fileGroups.length === 0) {
                alert('No valid files selected');
                return;
            }

            // Process first group (for now, handle one dataset at a time)
            const firstGroup = fileGroups[0];

            if (firstGroup.type === '3d-raw') {
                await this.loadCTVolume(firstGroup);
            } else if (firstGroup.type === 'tiff') {
                await this.loadTIFF(firstGroup);
            } else if (firstGroup.type === '2d-image') {
                // Handle standard 2D images
                this.images = fileGroups
                    .filter(g => g.type === '2d-image')
                    .map(g => g.file);

                if (this.images.length > 0) {
                    this.switchToStandardMode();
                    this.currentIndex = 0;
                    this.renderThumbnails();
                    this.displayImage(0);
                    this.updateNavigation();
                }
            }
        } catch (error) {
            console.error('Error loading files:', error);
            alert(`Error loading files: ${error.message}`);
        }
    }

    displayImage(index) {
        if (index < 0 || index >= this.images.length) return;

        this.currentIndex = index;
        const file = this.images[index];
        const url = URL.createObjectURL(file);

        this.mainImage.src = url;
        this.mainImage.classList.add('active');
        this.placeholder.style.display = 'none';
        this.fileName.textContent = file.name;
        this.resetView();
        this.updateThumbnailActive();
        this.updateNavigation();

        // Clear TIFF data and disable ROI for regular images
        this.currentTiffData = null;
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = true;
        roiBtn.classList.remove('active');
        this.roiMode2D = false;

        // Apply current filter settings to the new image
        if (this.currentMode === 'standard') {
            this.apply2DImageFilters();
        }
    }

    renderThumbnails() {
        this.thumbnailsContainer.innerHTML = '';

        this.images.forEach((file, index) => {
            const img = document.createElement('img');
            img.className = 'thumbnail';
            img.src = URL.createObjectURL(file);
            img.alt = file.name;
            img.addEventListener('click', () => this.displayImage(index));
            this.thumbnailsContainer.appendChild(img);
        });
    }

    updateThumbnailActive() {
        const thumbnails = this.thumbnailsContainer.querySelectorAll('.thumbnail');
        thumbnails.forEach((thumb, index) => {
            thumb.classList.toggle('active', index === this.currentIndex);
        });
    }

    navigate(direction) {
        const newIndex = this.currentIndex + direction;
        if (newIndex >= 0 && newIndex < this.images.length) {
            this.displayImage(newIndex);
        }
    }

    updateNavigation() {
        // Navigation UI removed - function kept for compatibility
    }

    zoom(delta) {
        this.zoomScale = Math.max(0.1, Math.min(5, this.zoomScale + delta));
        this.mainImage.style.transform = `scale(${this.zoomScale})`;
        this.zoomLevel.textContent = `${Math.round(this.zoomScale * 100)}%`;
    }

    resetView() {
        this.zoomScale = 1;
        this.mainImage.style.transform = 'scale(1)';
        this.zoomLevel.textContent = '100%';
        this.imageWrapper.scrollLeft = 0;
        this.imageWrapper.scrollTop = 0;
    }

    resetFilters() {
        // Reset contrast and brightness sliders and apply
        this.contrastSlider.value = 1.0;
        this.contrastValue.textContent = '1.0';
        this.brightnessSlider.value = 0;
        this.brightnessValue.textContent = '0';

        if (this.currentMode === 'standard') {
            this.apply2DImageFilters();
        }
    }

    updateImageInfo() {
        const img = this.mainImage;
        if (img.naturalWidth && img.naturalHeight) {
            this.imageInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight}px`;
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        this.dropZone.classList.add('drag-over');
    }

    handleDragLeave(e) {
        if (e.target === this.dropZone) {
            this.dropZone.classList.remove('drag-over');
        }
    }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        this.handleFiles(files);
    }

    // ===== 2D Image Mouse Handlers =====

    handleImageMouseDown(e) {
        if (this.roiMode2D) {
            this.roiSelecting2D = true;
            this.roiStart2D = { x: e.clientX, y: e.clientY };
            this.roiEnd2D = { x: e.clientX, y: e.clientY };
            this.createRoiOverlay2D();
            this.mainImage.style.cursor = 'crosshair';
            return;
        }
        this.startDrag(e);
    }

    handleImageMouseMove(e) {
        if (this.roiSelecting2D) {
            this.roiEnd2D = { x: e.clientX, y: e.clientY };
            this.drawRoiRectangle2D();
            return;
        }
        this.drag(e);
    }

    handleImageMouseUp(e) {
        if (this.roiSelecting2D) {
            this.roiSelecting2D = false;
            this.roiEnd2D = { x: e.clientX, y: e.clientY };
            this.applyRoiSelection2D();
            this.removeRoiOverlay2D();
            this.mainImage.style.cursor = this.roiMode2D ? 'crosshair' : 'grab';
            return;
        }
        this.endDrag();
    }

    startDrag(e) {
        if (this.zoomScale <= 1) return;
        this.isDragging = true;
        this.startX = e.pageX - this.imageWrapper.offsetLeft;
        this.startY = e.pageY - this.imageWrapper.offsetTop;
        this.scrollLeft = this.imageWrapper.scrollLeft;
        this.scrollTop = this.imageWrapper.scrollTop;
    }

    drag(e) {
        if (!this.isDragging) return;
        e.preventDefault();
        const x = e.pageX - this.imageWrapper.offsetLeft;
        const y = e.pageY - this.imageWrapper.offsetTop;
        const walkX = (x - this.startX) * 2;
        const walkY = (y - this.startY) * 2;
        this.imageWrapper.scrollLeft = this.scrollLeft - walkX;
        this.imageWrapper.scrollTop = this.scrollTop - walkY;
    }

    endDrag() {
        this.isDragging = false;
    }

    handleKeyboard(e) {
        if (this.images.length === 0) return;

        switch(e.key) {
            case 'ArrowLeft':
                this.navigate(-1);
                break;
            case 'ArrowRight':
                this.navigate(1);
                break;
            case '+':
            case '=':
                this.zoom(0.2);
                break;
            case '-':
                this.zoom(-0.2);
                break;
            case '0':
                this.resetView();
                break;
            case 'f':
            case 'F':
                this.toggleFullscreen();
                break;
        }
    }

    handleWheel(e) {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.zoom(delta);
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Toggle ROI selection mode for CT viewer or 2D images
     */
    toggleRoiMode() {
        const roiBtn = document.getElementById('roiBtn');

        if (this.currentMode === 'ct' && this.ctViewer) {
            // CT mode - use CTViewer's ROI handling
            const isActive = this.ctViewer.toggleRoiMode();

            if (isActive) {
                roiBtn.classList.add('active');
                roiBtn.title = 'ROI mode active - draw rectangle to set range';
            } else {
                roiBtn.classList.remove('active');
                roiBtn.title = 'Set range from region';
            }
        } else if (this.currentMode === 'standard') {
            // 2D mode - toggle local ROI state
            this.roiMode2D = !this.roiMode2D;

            if (this.roiMode2D) {
                roiBtn.classList.add('active');
                roiBtn.title = 'ROI mode active - draw rectangle to set range';
                this.mainImage.style.cursor = 'crosshair';
            } else {
                roiBtn.classList.remove('active');
                roiBtn.title = 'Set range from region';
                this.mainImage.style.cursor = 'grab';
                // Clean up any lingering overlay
                this.removeRoiOverlay2D();
            }
        }
    }

    /**
     * Toggle crosshair visibility for CT viewer
     */
    toggleCrosshairs() {
        if (this.currentMode !== 'ct' || !this.ctViewer) {
            return;
        }

        const isEnabled = this.ctViewer.toggleCrosshairs();
        const crosshairBtn = document.getElementById('crosshairBtn');

        if (isEnabled) {
            crosshairBtn.classList.add('active');
            crosshairBtn.title = 'Crosshairs visible - click to hide';
            this.pixelInfoGroup.style.display = '';
            // Trigger update to show current pixel value
            this.ctViewer.notifyCrosshairChange();
        } else {
            crosshairBtn.classList.remove('active');
            crosshairBtn.title = 'Crosshairs hidden - click to show';
            this.pixelInfoGroup.style.display = 'none';
        }
    }

    // ===== 2D ROI Methods =====

    /**
     * Create overlay canvas for 2D ROI selection
     */
    createRoiOverlay2D() {
        if (this.roiCanvas2D) {
            this.removeRoiOverlay2D();
        }

        const rect = this.mainImage.getBoundingClientRect();

        this.roiCanvas2D = document.createElement('canvas');
        this.roiCanvas2D.width = rect.width;
        this.roiCanvas2D.height = rect.height;
        this.roiCanvas2D.style.position = 'absolute';
        this.roiCanvas2D.style.top = this.mainImage.offsetTop + 'px';
        this.roiCanvas2D.style.left = this.mainImage.offsetLeft + 'px';
        this.roiCanvas2D.style.pointerEvents = 'none';
        this.roiCanvas2D.style.zIndex = '10';

        this.mainImage.parentElement.appendChild(this.roiCanvas2D);
    }

    /**
     * Draw ROI rectangle on 2D overlay
     */
    drawRoiRectangle2D() {
        if (!this.roiCanvas2D) return;

        const ctx = this.roiCanvas2D.getContext('2d');
        ctx.clearRect(0, 0, this.roiCanvas2D.width, this.roiCanvas2D.height);

        const rect = this.mainImage.getBoundingClientRect();
        const x1 = this.roiStart2D.x - rect.left;
        const y1 = this.roiStart2D.y - rect.top;
        const x2 = this.roiEnd2D.x - rect.left;
        const y2 = this.roiEnd2D.y - rect.top;

        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);

        // Draw rectangle
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x, y, width, height);

        // Draw semi-transparent fill
        ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
        ctx.fillRect(x, y, width, height);
    }

    /**
     * Remove 2D ROI overlay
     */
    removeRoiOverlay2D() {
        if (this.roiCanvas2D && this.roiCanvas2D.parentElement) {
            this.roiCanvas2D.parentElement.removeChild(this.roiCanvas2D);
        }
        this.roiCanvas2D = null;
    }

    /**
     * Apply ROI selection to 2D image - analyze pixels and adjust contrast/brightness
     * For uint16 grayscale TIFFs, reads raw 16-bit values from the TIFF data
     */
    applyRoiSelection2D() {
        if (!this.mainImage.complete || !this.mainImage.naturalWidth) return;
        if (!this.currentTiffData) {
            console.warn('ROI only supported for uint16 grayscale TIFFs');
            return;
        }

        const imgRect = this.mainImage.getBoundingClientRect();

        // Get ROI coordinates relative to displayed image
        const x1 = this.roiStart2D.x - imgRect.left;
        const y1 = this.roiStart2D.y - imgRect.top;
        const x2 = this.roiEnd2D.x - imgRect.left;
        const y2 = this.roiEnd2D.y - imgRect.top;

        // Convert to image coordinates (accounting for display scaling)
        const scaleX = this.mainImage.naturalWidth / imgRect.width;
        const scaleY = this.mainImage.naturalHeight / imgRect.height;

        const imgX1 = Math.max(0, Math.floor(Math.min(x1, x2) * scaleX));
        const imgY1 = Math.max(0, Math.floor(Math.min(y1, y2) * scaleY));
        const imgX2 = Math.min(this.currentTiffData.width, Math.ceil(Math.max(x1, x2) * scaleX));
        const imgY2 = Math.min(this.currentTiffData.height, Math.ceil(Math.max(y1, y2) * scaleY));

        if (imgX2 <= imgX1 || imgY2 <= imgY1) {
            console.warn('ROI selection too small or outside image');
            return;
        }

        // Extract raw uint16 values from TIFF data
        const { min, max } = this.extractUint16RoiValues(imgX1, imgY1, imgX2, imgY2);

        if (min >= max) {
            console.warn('Could not calculate valid range from ROI');
            return;
        }

        console.log(`2D ROI uint16 range: ${min} - ${max}`);

        // For uint16 data displayed as 8-bit, we need to map the ROI range to the display
        // The TIFF is displayed with some default mapping (likely linear scaling to 8-bit)
        // We'll calculate what portion of the 16-bit range the ROI represents and adjust accordingly

        // Assume the display maps the full uint16 range (0-65535) to 8-bit (0-255)
        // The ROI's min/max in the 16-bit space corresponds to some 8-bit values
        const displayMin = (min / 65535) * 255;
        const displayMax = (max / 65535) * 255;
        const displayCenter = (displayMin + displayMax) / 2;
        const displayRange = displayMax - displayMin;

        console.log(`Display equivalent: ${displayMin.toFixed(1)} - ${displayMax.toFixed(1)}`);

        // Calculate contrast and brightness to map this range to full display
        // We want displayMin -> 0 and displayMax -> 255
        const idealContrast = 256 / displayRange;
        const contrast = Math.max(0.5, Math.min(2.0, idealContrast));

        // After contrast, center moves to: (displayCenter - 128) * contrast + 128
        const centerAfterContrast = (displayCenter - 128) * contrast + 128;

        // Adjust brightness to bring center to 128
        let brightness = 1.0;
        if (centerAfterContrast > 0) {
            brightness = 128 / centerAfterContrast;
        }
        brightness = Math.max(0, Math.min(2.0, brightness));

        const brightnessSliderValue = Math.round((brightness - 1) * 100);

        console.log(`Calculated: contrast=${contrast.toFixed(2)}, brightness=${brightness.toFixed(2)} (slider: ${brightnessSliderValue})`);

        // Update sliders
        this.contrastSlider.value = contrast.toFixed(1);
        this.contrastValue.textContent = contrast.toFixed(1);
        this.brightnessSlider.value = brightnessSliderValue;
        this.brightnessValue.textContent = brightnessSliderValue;

        // Apply filters
        this.apply2DImageFilters();
    }

    /**
     * Extract raw uint16 values from TIFF buffer for the specified ROI region
     */
    extractUint16RoiValues(x1, y1, x2, y2) {
        if (!this.currentTiffData || !this.currentTiffData.tiff) {
            return { min: 0, max: 0 };
        }

        const tiff = this.currentTiffData.tiff;
        const width = this.currentTiffData.width;
        const height = this.currentTiffData.height;

        // Get TIFF structure info
        // Tag 273: StripOffsets, Tag 278: RowsPerStrip, Tag 279: StripByteCounts
        const stripOffsets = tiff.getField(273);
        const rowsPerStrip = tiff.getField(278) || height;
        const compression = tiff.getField(259) || 1; // 1 = no compression

        if (compression !== 1) {
            console.warn('Compressed TIFFs not supported for ROI, compression:', compression);
            return { min: 0, max: 0 };
        }

        if (!stripOffsets) {
            console.warn('Could not find strip offsets in TIFF');
            return { min: 0, max: 0 };
        }

        const buffer = this.currentTiffData.rawBuffer;
        const dataView = new DataView(buffer);

        // Detect endianness from TIFF header
        const byteOrder = dataView.getUint16(0, false);
        const littleEndian = (byteOrder === 0x4949); // 'II' = little endian

        let min = 65535;
        let max = 0;

        // Convert stripOffsets to array if it's a single value
        const offsets = Array.isArray(stripOffsets) ? stripOffsets : [stripOffsets];

        // Iterate through the ROI region
        for (let y = y1; y < y2; y++) {
            // Find which strip this row belongs to
            const stripIndex = Math.floor(y / rowsPerStrip);
            const rowInStrip = y % rowsPerStrip;

            if (stripIndex >= offsets.length) continue;

            const stripOffset = offsets[stripIndex];
            const rowOffset = stripOffset + (rowInStrip * width * 2); // 2 bytes per pixel

            for (let x = x1; x < x2; x++) {
                const pixelOffset = rowOffset + (x * 2);

                if (pixelOffset + 2 <= buffer.byteLength) {
                    const value = dataView.getUint16(pixelOffset, littleEndian);
                    if (value < min) min = value;
                    if (value > max) max = value;
                }
            }
        }

        return { min, max };
    }

    // ===== CT Imaging Methods =====

    initCTComponents() {
        // Initialize CT viewer
        this.ctViewer = new CTViewer();
        this.ctViewer.initialize(this.canvasXY, this.canvasXZ, this.canvasYZ);

        // Set up CT controls event listeners
        if (this.contrastSlider) {
            this.contrastSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.contrastValue.textContent = value.toFixed(1);

                if (this.currentMode === 'ct' && this.ctViewer) {
                    // Apply to 3D CT viewer
                    this.ctViewer.updateContrast(value);
                } else if (this.currentMode === 'standard') {
                    // Apply to 2D image using CSS filters
                    this.apply2DImageFilters();
                }
            });
        }

        if (this.brightnessSlider) {
            this.brightnessSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.brightnessValue.textContent = value;

                if (this.currentMode === 'ct' && this.ctViewer) {
                    // Apply to 3D CT viewer
                    this.ctViewer.updateBrightness(value);
                } else if (this.currentMode === 'standard') {
                    // Apply to 2D image using CSS filters
                    this.apply2DImageFilters();
                }
            });
        }

        // Listen for slice change events from CT viewer
        document.addEventListener('slicechange', (e) => {
            const { axis, sliceIndex, totalSlices } = e.detail;
            const indicator = axis === 'xy' ? this.sliceIndicatorXY :
                            axis === 'xz' ? this.sliceIndicatorXZ :
                            this.sliceIndicatorYZ;

            if (indicator) {
                const axisLabel = axis.toUpperCase();
                indicator.textContent = `${axisLabel}: ${sliceIndex + 1}/${totalSlices}`;
            }
        });

        // Listen for zoom change events
        document.addEventListener('zoomchange', (e) => {
            this.zoomLevel.textContent = `${Math.round(e.detail.zoom * 100)}%`;
        });

        // Listen for crosshair position change events
        document.addEventListener('crosshairchange', (e) => {
            const { x, y, z, value } = e.detail;
            if (this.pixelInfo) {
                this.pixelInfo.textContent = `X: ${x}, Y: ${y}, Z: ${z} = ${value}`;
            }
        });
    }

    async loadCTVolume(fileGroup) {
        try {
            // Show loading indicator
            this.showLoadingIndicator('Loading 3D volume...');

            // Load the volume using FileParser
            const volumeData = await this.fileParser.load3DVolume(
                fileGroup.rawFile,
                fileGroup.jsonFile,
                (progress) => {
                    this.updateLoadingProgress(progress);
                },
                fileGroup.volumeinfoFile
            );

            // Switch to CT mode
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);

            // Update UI
            this.fileName.textContent = fileGroup.name;
            this.imageInfo.textContent = `${info.dimensions[0]}×${info.dimensions[1]}×${info.dimensions[2]} | ${info.dataType}`;

            // Initialize slice indicators
            const [nx, ny, nz] = info.dimensions;
            this.sliceIndicatorXY.textContent = `XY: ${Math.floor(nz/2) + 1}/${nz}`;
            this.sliceIndicatorXZ.textContent = `XZ: ${Math.floor(ny/2) + 1}/${ny}`;
            this.sliceIndicatorYZ.textContent = `YZ: ${Math.floor(nx/2) + 1}/${nx}`;

            // Hide loading indicator
            this.hideLoadingIndicator();

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    async loadTIFF(fileGroup) {
        try {
            this.showLoadingIndicator('Loading TIFF...');

            const tiffData = await this.fileParser.loadTIFF(fileGroup.file);

            if (tiffData.type === '2d-tiff') {
                // Handle as standard 2D image
                this.switchToStandardMode();
                // Convert the tiff.js canvas to a blob URL (browsers don't support TIFF in <img> natively)
                const canvas = tiffData.tiff.toCanvas();
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const url = URL.createObjectURL(blob);
                this.mainImage.src = url;
                this.mainImage.classList.add('active');
                this.placeholder.style.display = 'none';
                this.fileName.textContent = fileGroup.name;

                // Store TIFF data for uint16 grayscale ROI support
                if (tiffData.isGrayscale && tiffData.isUint16) {
                    this.currentTiffData = tiffData;
                    // Enable ROI button for uint16 grayscale
                    const roiBtn = document.getElementById('roiBtn');
                    roiBtn.disabled = false;
                    console.log(`Loaded uint16 grayscale TIFF: ${tiffData.width}x${tiffData.height}, ${tiffData.bitsPerSample} bits`);
                } else {
                    this.currentTiffData = null;
                    // Disable ROI button for non-grayscale images
                    const roiBtn = document.getElementById('roiBtn');
                    roiBtn.disabled = true;
                    console.log(`Loaded TIFF: ${tiffData.width}x${tiffData.height}, ${tiffData.bitsPerSample} bits, samples: ${tiffData.samplesPerPixel} (ROI disabled)`);
                }
            } else {
                // TODO: Handle multi-page TIFF as 3D volume
                this.currentTiffData = null;
                alert('Multi-page TIFF as 3D volume not yet implemented');
            }

            this.hideLoadingIndicator();

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    switchToStandardMode() {
        this.currentMode = 'standard';
        this.standard2DView.style.display = 'flex';
        this.ct3DView.style.display = 'none';

        // Show controls but hide slice indicators for 2D mode
        this.ctControls.style.display = 'flex';
        const sliceControls = document.getElementById('sliceControls');
        if (sliceControls) {
            sliceControls.style.display = 'none';
        }

        // Disable ROI button by default in 2D mode (will be enabled for uint16 grayscale TIFFs)
        // Disable crosshairs (only work in CT mode)
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = true;  // Will be enabled by loadTIFF for uint16 grayscale
        roiBtn.classList.remove('active');
        this.roiMode2D = false;
        this.currentTiffData = null;  // Clear TIFF data
        if (this.ctViewer && this.ctViewer.isRoiMode()) {
            this.ctViewer.toggleRoiMode();
        }

        const crosshairBtn = document.getElementById('crosshairBtn');
        crosshairBtn.disabled = true;
        this.pixelInfoGroup.style.display = 'none';

        // Apply current filter settings to 2D image
        this.apply2DImageFilters();

        // Update zoom controls to work with standard view
        document.getElementById('zoomInBtn').onclick = () => this.zoom(0.2);
        document.getElementById('zoomOutBtn').onclick = () => this.zoom(-0.2);
        document.getElementById('resetBtn').onclick = () => {
            this.resetView();
            this.resetFilters();
        };
    }

    switchToCTMode() {
        this.currentMode = 'ct';
        this.standard2DView.style.display = 'none';
        this.ct3DView.style.display = 'grid';
        this.ctControls.style.display = 'flex';

        // Reset 2D ROI state when switching to CT mode
        this.roiMode2D = false;
        this.removeRoiOverlay2D();

        // Show slice controls for 3D mode
        const sliceControls = document.getElementById('sliceControls');
        if (sliceControls) {
            sliceControls.style.display = 'flex';
        }

        // Enable ROI and crosshair buttons for CT mode
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = false;
        roiBtn.classList.remove('active');

        const crosshairBtn = document.getElementById('crosshairBtn');
        crosshairBtn.disabled = false;
        // Set initial state based on CTViewer
        if (this.ctViewer && this.ctViewer.isCrosshairEnabled()) {
            crosshairBtn.classList.add('active');
            this.pixelInfoGroup.style.display = '';
        } else {
            crosshairBtn.classList.remove('active');
            this.pixelInfoGroup.style.display = 'none';
        }

        // Update zoom controls to work with CT viewer
        document.getElementById('zoomInBtn').onclick = () => {
            if (this.ctViewer) {
                const state = this.ctViewer.getState();
                this.ctViewer.updateZoom(state.zoom + 0.2);
            }
        };

        document.getElementById('zoomOutBtn').onclick = () => {
            if (this.ctViewer) {
                const state = this.ctViewer.getState();
                this.ctViewer.updateZoom(state.zoom - 0.2);
            }
        };

        document.getElementById('resetBtn').onclick = () => {
            if (this.ctViewer) {
                this.ctViewer.resetView();
                this.ctViewer.resetDataRange();
                // Reset sliders
                this.contrastSlider.value = 1.0;
                this.contrastValue.textContent = '1.0';
                this.brightnessSlider.value = 0;
                this.brightnessValue.textContent = '0';
            }
        };
    }

    showLoadingIndicator(message) {
        let overlay = document.querySelector('.loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-text">${message}</div>
                <div class="loading-progress"></div>
            `;
            this.dropZone.appendChild(overlay);
        }
    }

    hideLoadingIndicator() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    updateLoadingProgress(progress) {
        const progressEl = document.querySelector('.loading-progress');
        if (progressEl) {
            if (progress.stage === 'metadata') {
                progressEl.textContent = 'Loading metadata...';
            } else if (progress.stage === 'loading') {
                progressEl.textContent = 'Loading volume data...';
            } else if (progress.stage === 'parsing') {
                progressEl.textContent = 'Parsing volume data...';
            } else if (progress.stage === 'complete') {
                progressEl.textContent = 'Complete!';
            }
        }
    }

    /**
     * Apply contrast and brightness filters to 2D images using CSS filters
     */
    apply2DImageFilters() {
        if (!this.mainImage) return;

        const contrast = parseFloat(this.contrastSlider.value);
        const brightness = parseInt(this.brightnessSlider.value);

        // Convert brightness from -100/+100 to CSS brightness percentage
        // CSS brightness: 0% = black, 100% = normal, 200% = very bright
        // Our slider: -100 = darker, 0 = normal, +100 = brighter
        const cssBrightness = 100 + brightness;

        // Convert contrast: our range is 0.5 to 2.0, CSS uses percentage
        const cssContrast = contrast * 100;

        // Apply CSS filter
        this.mainImage.style.filter = `contrast(${cssContrast}%) brightness(${cssBrightness}%)`;
    }
}

// Initialize the viewer
const viewer = new ImageViewer();
