class ImageViewer {
    constructor() {
        this.fileParser = new FileParser();
        this.ctViewer = null;
        this.histogram = null;

        this.initElements();
        this.initEventListeners();
        this.initCTComponents();
    }

    initElements() {
        // Common UI elements
        this.placeholder = document.getElementById('placeholder');
        this.fileInput = document.getElementById('fileInput');
        this.dropZone = document.getElementById('dropZone');
        this.fileName = document.getElementById('fileName');
        this.imageInfo = document.getElementById('imageInfo');
        this.zoomLevel = document.getElementById('zoomLevel');

        // CT view elements
        this.ct3DView = document.getElementById('ct3DView');
        this.sliceIndicatorXY = document.getElementById('sliceIndicatorXY');
        this.sliceIndicatorXZ = document.getElementById('sliceIndicatorXZ');
        this.sliceIndicatorYZ = document.getElementById('sliceIndicatorYZ');
        this.pixelInfoGroup = document.getElementById('pixelInfoGroup');
        this.pixelInfo = document.getElementById('pixelInfo');

        // Canvas elements for volume view
        this.canvasXY = document.getElementById('canvasXY');
        this.canvasXZ = document.getElementById('canvasXZ');
        this.canvasYZ = document.getElementById('canvasYZ');
        this.canvas3D = document.getElementById('canvas3D');

        // Histogram elements
        this.histogramCanvas = document.getElementById('histogramCanvas');
        this.handleMin = document.getElementById('handleMin');
        this.handleMax = document.getElementById('handleMax');
        this.histogramMin = document.getElementById('histogramMin');
        this.histogramMax = document.getElementById('histogramMax');
    }

    initEventListeners() {
        // Button events
        document.getElementById('openBtn').addEventListener('click', () => this.fileInput.click());
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
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
                await this.load2DImage(firstGroup);
            }
        } catch (error) {
            console.error('Error loading files:', error);
            alert(`Error loading files: ${error.message}`);
        }
    }

    // Zoom controls - delegate to CT viewer
    zoomIn() {
        if (this.ctViewer) {
            const state = this.ctViewer.getState();
            this.ctViewer.updateZoom(state.zoom + 0.2);
        }
    }

    zoomOut() {
        if (this.ctViewer) {
            const state = this.ctViewer.getState();
            this.ctViewer.updateZoom(state.zoom - 0.2);
        }
    }

    resetView() {
        if (this.ctViewer) {
            this.ctViewer.resetView();
            this.ctViewer.resetDataRange();
        }
        if (this.histogram) {
            this.histogram.reset();
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

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Toggle ROI selection mode
     */
    toggleRoiMode() {
        if (!this.ctViewer) return;

        const roiBtn = document.getElementById('roiBtn');
        const isActive = this.ctViewer.toggleRoiMode();

        if (isActive) {
            roiBtn.classList.add('active');
            roiBtn.title = 'ROI mode active - draw rectangle to set range';
        } else {
            roiBtn.classList.remove('active');
            roiBtn.title = 'Set range from region';
        }
    }

    /**
     * Toggle crosshair visibility
     */
    toggleCrosshairs() {
        if (!this.ctViewer) return;

        const crosshairBtn = document.getElementById('crosshairBtn');
        const isEnabled = this.ctViewer.toggleCrosshairs();

        if (isEnabled) {
            crosshairBtn.classList.add('active');
            crosshairBtn.title = 'Crosshairs visible - click to hide';
            this.pixelInfoGroup.style.display = 'block';
            this.ctViewer.notifyCrosshairChange();
        } else {
            crosshairBtn.classList.remove('active');
            crosshairBtn.title = 'Crosshairs hidden - click to show';
            this.pixelInfoGroup.style.display = 'none';
        }
    }

    // ===== Volume Loading Methods =====

    initCTComponents() {
        // Initialize CT viewer
        this.ctViewer = new CTViewer();
        this.ctViewer.initialize(this.canvasXY, this.canvasXZ, this.canvasYZ, this.canvas3D);

        // Initialize histogram
        this.histogram = new Histogram(
            this.histogramCanvas,
            this.handleMin,
            this.handleMax,
            this.histogramMin,
            this.histogramMax
        );

        // Connect histogram to CTViewer range system
        this.histogram.onRangeChange = (min, max) => {
            if (this.ctViewer) {
                // Update all 2D slice renderers with new data range
                Object.values(this.ctViewer.renderers).forEach(renderer => {
                    renderer.setDataRange(min, max);
                });
                this.ctViewer.renderAllViews();

                // Update 3D renderer with new display range
                if (this.ctViewer.renderer3D) {
                    this.ctViewer.renderer3D.setDisplayRange(min, max);
                }
            }
        };

        // 3D quality selector
        const quality3DSelect = document.getElementById('quality3DSelect');
        if (quality3DSelect) {
            quality3DSelect.addEventListener('change', (e) => {
                if (this.ctViewer && this.ctViewer.renderer3D) {
                    this.ctViewer.renderer3D.setQuality(e.target.value);
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

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

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

            // Convert TIFF to VolumeData (treats 2D as depth=1 volume)
            const volumeData = this.fileParser.convertTiffToVolume(tiffData);

            // Switch to CT mode and display
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.fileName.textContent = fileGroup.name;
            const [nx, ny, nz] = info.dimensions;
            this.imageInfo.textContent = `${nx}×${ny}×${nz} | ${info.dataType}`;

            // Initialize slice indicators
            this.sliceIndicatorXY.textContent = `XY: ${Math.floor(nz/2) + 1}/${nz}`;
            this.sliceIndicatorXZ.textContent = `XZ: ${Math.floor(ny/2) + 1}/${ny}`;
            this.sliceIndicatorYZ.textContent = `YZ: ${Math.floor(nx/2) + 1}/${nx}`;

            this.hideLoadingIndicator();

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    async load2DImage(fileGroup) {
        try {
            this.showLoadingIndicator('Loading image...');

            const file = fileGroup.file;
            const volumeData = await this.convertImageToVolume(file);

            // Switch to CT mode and display
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.fileName.textContent = file.name;
            const [nx, ny, nz] = info.dimensions;
            this.imageInfo.textContent = `${nx}×${ny}×${nz} | ${info.dataType}`;

            // Initialize slice indicators
            this.sliceIndicatorXY.textContent = `XY: ${Math.floor(nz/2) + 1}/${nz}`;
            this.sliceIndicatorXZ.textContent = `XZ: ${Math.floor(ny/2) + 1}/${ny}`;
            this.sliceIndicatorYZ.textContent = `YZ: ${Math.floor(nx/2) + 1}/${nx}`;

            this.hideLoadingIndicator();

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    convertImageToVolume(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const pixels = imageData.data;
                const width = canvas.width;
                const height = canvas.height;

                // Check if grayscale (R≈G≈B for all pixels, sample first 100)
                let isGrayscale = true;
                for (let i = 0; i < Math.min(pixels.length, 400); i += 4) {
                    if (Math.abs(pixels[i] - pixels[i+1]) > 5 || Math.abs(pixels[i+1] - pixels[i+2]) > 5) {
                        isGrayscale = false;
                        break;
                    }
                }

                let arrayBuffer, metadata;

                if (isGrayscale) {
                    // Grayscale - single channel
                    const data = new Uint8Array(width * height);
                    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
                        data[j] = pixels[i];
                    }
                    arrayBuffer = data.buffer;
                    metadata = {
                        dimensions: [width, height, 1],
                        dataType: 'uint8',
                        spacing: [1.0, 1.0, 1.0],
                        isRGB: false
                    };
                } else {
                    // RGB - treat as 3-channel volume
                    const data = new Uint8Array(width * height * 3);
                    const sliceSize = width * height;
                    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
                        data[j] = pixels[i];                    // R channel
                        data[j + sliceSize] = pixels[i + 1];    // G channel
                        data[j + sliceSize * 2] = pixels[i + 2]; // B channel
                    }
                    arrayBuffer = data.buffer;
                    metadata = {
                        dimensions: [width, height, 3],
                        dataType: 'uint8',
                        spacing: [1.0, 1.0, 1.0],
                        isRGB: true
                    };
                }

                URL.revokeObjectURL(img.src);
                resolve(new VolumeData(arrayBuffer, metadata));
            };

            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Failed to load image'));
            };

            img.src = URL.createObjectURL(file);
        });
    }

    switchToCTMode() {
        // Hide placeholder, show volume view
        if (this.placeholder) this.placeholder.style.display = 'none';
        if (this.ct3DView) this.ct3DView.style.display = 'grid';

        // Show slice controls and 3D quality
        const sliceControls = document.getElementById('sliceControls');
        if (sliceControls) sliceControls.style.display = 'block';

        const quality3DGroup = document.getElementById('quality3DGroup');
        if (quality3DGroup) quality3DGroup.style.display = 'block';

        // Enable ROI and crosshair buttons
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = false;
        roiBtn.classList.remove('active');

        const crosshairBtn = document.getElementById('crosshairBtn');
        crosshairBtn.disabled = false;

        // Set crosshair state based on CTViewer
        if (this.ctViewer && this.ctViewer.isCrosshairEnabled()) {
            crosshairBtn.classList.add('active');
            this.pixelInfoGroup.style.display = 'block';
        } else {
            crosshairBtn.classList.remove('active');
            this.pixelInfoGroup.style.display = 'none';
        }
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

}

// Initialize the viewer
const viewer = new ImageViewer();
