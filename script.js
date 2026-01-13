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
        this.imageCounter = document.getElementById('imageCounter');
        this.fileName = document.getElementById('fileName');
        this.imageInfo = document.getElementById('imageInfo');
        this.zoomLevel = document.getElementById('zoomLevel');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
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
        this.prevBtn.addEventListener('click', () => this.navigate(-1));
        this.nextBtn.addEventListener('click', () => this.navigate(1));

        // File input
        this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        // Drag and drop
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Image dragging for panning
        this.mainImage.addEventListener('mousedown', (e) => this.startDrag(e));
        this.mainImage.addEventListener('mousemove', (e) => this.drag(e));
        this.mainImage.addEventListener('mouseup', () => this.endDrag());
        this.mainImage.addEventListener('mouseleave', () => this.endDrag());

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
        this.prevBtn.disabled = this.currentIndex === 0;
        this.nextBtn.disabled = this.currentIndex === this.images.length - 1;
        this.imageCounter.textContent = `${this.currentIndex + 1} / ${this.images.length}`;
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
     * Toggle ROI selection mode for CT viewer
     */
    toggleRoiMode() {
        if (this.currentMode !== 'ct' || !this.ctViewer) {
            return;
        }

        const isActive = this.ctViewer.toggleRoiMode();
        const roiBtn = document.getElementById('roiBtn');

        if (isActive) {
            roiBtn.classList.add('active');
            roiBtn.title = 'ROI mode active - draw rectangle to set range';
        } else {
            roiBtn.classList.remove('active');
            roiBtn.title = 'Set range from region';
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
        } else {
            crosshairBtn.classList.remove('active');
            crosshairBtn.title = 'Crosshairs hidden - click to show';
        }
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
            } else {
                // TODO: Handle multi-page TIFF as 3D volume
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

        // Disable ROI mode and crosshairs (only work in CT mode)
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = true;
        roiBtn.classList.remove('active');
        if (this.ctViewer && this.ctViewer.isRoiMode()) {
            this.ctViewer.toggleRoiMode();
        }

        const crosshairBtn = document.getElementById('crosshairBtn');
        crosshairBtn.disabled = true;

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

        // Show slice controls for 3D mode
        const sliceControls = document.getElementById('sliceControls');
        if (sliceControls) {
            sliceControls.style.display = 'flex';
        }

        // Enable ROI and crosshair buttons for CT mode
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = false;

        const crosshairBtn = document.getElementById('crosshairBtn');
        crosshairBtn.disabled = false;
        // Set initial state based on CTViewer
        if (this.ctViewer && this.ctViewer.isCrosshairEnabled()) {
            crosshairBtn.classList.add('active');
        } else {
            crosshairBtn.classList.remove('active');
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
