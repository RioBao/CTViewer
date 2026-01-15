class ImageViewer {
    constructor() {
        // CT imaging components
        this.fileParser = new FileParser();
        this.ctViewer = null;

        this.initElements();
        this.initEventListeners();
        this.initCTComponents();
    }

    initElements() {
        // File input elements
        this.placeholder = document.getElementById('placeholder');
        this.fileInput = document.getElementById('fileInput');
        this.dropZone = document.getElementById('dropZone');
        this.fileName = document.getElementById('fileName');
        this.imageInfo = document.getElementById('imageInfo');
        this.zoomLevel = document.getElementById('zoomLevel');
        this.imageWrapper = document.querySelector('.image-wrapper');

        // CT view elements
        this.ct3DView = document.getElementById('ct3DView');
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
        this.canvas3D = document.getElementById('canvas3D');
    }

    initEventListeners() {
        // Button events - delegate to CTViewer
        document.getElementById('openBtn').addEventListener('click', () => this.fileInput.click());
        document.getElementById('zoomInBtn').addEventListener('click', () => {
            if (this.ctViewer) {
                const state = this.ctViewer.getState();
                this.ctViewer.updateZoom(state.zoom + 0.2);
            }
        });
        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            if (this.ctViewer) {
                const state = this.ctViewer.getState();
                this.ctViewer.updateZoom(state.zoom - 0.2);
            }
        });
        document.getElementById('resetBtn').addEventListener('click', () => {
            if (this.ctViewer) {
                this.ctViewer.resetView();
                this.ctViewer.resetDataRange();
                // Reset sliders
                this.contrastSlider.value = 1.0;
                this.contrastValue.textContent = '1.0';
                this.brightnessSlider.value = 0;
                this.brightnessValue.textContent = '0';
            }
        });
        document.getElementById('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('roiBtn').addEventListener('click', () => this.toggleRoiMode());
        document.getElementById('crosshairBtn').addEventListener('click', () => this.toggleCrosshairs());

        // File input
        this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        // Drag and drop
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    async handleFiles(files) {
        try {
            // Group files by type (pairs .raw with .json, etc.)
            const fileGroups = this.fileParser.groupFiles(files);

            if (fileGroups.length === 0) {
                alert('No valid files selected');
                return;
            }

            // Process first group
            const firstGroup = fileGroups[0];
            let volumeData;

            if (firstGroup.type === '3d-raw') {
                // Load 3D RAW volume
                volumeData = await this.loadCTVolume(firstGroup);
            } else if (firstGroup.type === 'tiff') {
                // Load TIFF and convert to volume
                volumeData = await this.loadTIFF(firstGroup);
            } else if (firstGroup.type === '2d-image') {
                // Convert 2D image to volume
                this.showLoadingIndicator('Loading image...');
                volumeData = await this.fileParser.convertImageToVolume(firstGroup.file);
                this.hideLoadingIndicator();
                this.fileName.textContent = firstGroup.name;
            }

            if (volumeData) {
                this.displayVolume(volumeData);
            }
        } catch (error) {
            this.hideLoadingIndicator();
            console.error('Error loading files:', error);
            alert(`Error loading files: ${error.message}`);
        }
    }

    /**
     * Display a volume in the viewer
     */
    displayVolume(volumeData) {
        // Show CT view, hide placeholder
        this.ct3DView.style.display = 'grid';
        this.placeholder.style.display = 'none';

        // Load volume into CT viewer
        const info = this.ctViewer.loadVolume(volumeData);

        // Update UI
        const [nx, ny, nz] = info.dimensions;
        this.imageInfo.textContent = `${nx}×${ny}×${nz} | ${info.dataType}`;

        // Show/hide controls based on volume depth
        const sliceControls = document.getElementById('sliceControls');
        const quality3DGroup = document.getElementById('quality3DGroup');

        if (nz === 1) {
            // Single-slice volume (2D image) - hide slice controls and 3D quality
            if (sliceControls) sliceControls.style.display = 'none';
            if (quality3DGroup) quality3DGroup.style.display = 'none';
        } else {
            // Multi-slice volume - show all controls
            if (sliceControls) sliceControls.style.display = 'block';
            if (quality3DGroup) quality3DGroup.style.display = 'block';
        }

        // Enable ROI and crosshair buttons
        const roiBtn = document.getElementById('roiBtn');
        roiBtn.disabled = false;
        roiBtn.classList.remove('active');

        const crosshairBtn = document.getElementById('crosshairBtn');
        crosshairBtn.disabled = false;
        if (this.ctViewer.isCrosshairEnabled()) {
            crosshairBtn.classList.add('active');
            this.pixelInfoGroup.style.display = 'block';
        } else {
            crosshairBtn.classList.remove('active');
            this.pixelInfoGroup.style.display = 'none';
        }

        // Reset sliders
        this.contrastSlider.value = 1.0;
        this.contrastValue.textContent = '1.0';
        this.brightnessSlider.value = 0;
        this.brightnessValue.textContent = '0';
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

    handleKeyboard(e) {
        switch(e.key) {
            case '+':
            case '=':
                if (this.ctViewer) {
                    const state = this.ctViewer.getState();
                    this.ctViewer.updateZoom(state.zoom + 0.2);
                }
                break;
            case '-':
                if (this.ctViewer) {
                    const state = this.ctViewer.getState();
                    this.ctViewer.updateZoom(state.zoom - 0.2);
                }
                break;
            case '0':
                if (this.ctViewer) {
                    this.ctViewer.resetView();
                }
                break;
            case 'f':
            case 'F':
                this.toggleFullscreen();
                break;
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

    // ===== CT Imaging Methods =====

    initCTComponents() {
        // Initialize CT viewer
        this.ctViewer = new CTViewer();
        this.ctViewer.initialize(this.canvasXY, this.canvasXZ, this.canvasYZ, this.canvas3D);

        // Set up contrast slider
        if (this.contrastSlider) {
            this.contrastSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.contrastValue.textContent = value.toFixed(1);
                if (this.ctViewer) {
                    this.ctViewer.updateContrast(value);
                }
            });
        }

        // Set up brightness slider
        if (this.brightnessSlider) {
            this.brightnessSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.brightnessValue.textContent = value;
                if (this.ctViewer) {
                    this.ctViewer.updateBrightness(value);
                }
            });
        }

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
            const { axis, sliceIndex, totalSlices, channelLabel } = e.detail;
            const indicator = axis === 'xy' ? this.sliceIndicatorXY :
                            axis === 'xz' ? this.sliceIndicatorXZ :
                            this.sliceIndicatorYZ;

            if (indicator) {
                const axisLabel = axis.toUpperCase();
                let text = `${axisLabel}: ${sliceIndex + 1}/${totalSlices}`;
                if (channelLabel) {
                    text += ` (${channelLabel})`;
                }
                indicator.textContent = text;
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

            // Update UI
            this.fileName.textContent = fileGroup.name;

            // Hide loading indicator
            this.hideLoadingIndicator();

            return volumeData;

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    async loadTIFF(fileGroup) {
        try {
            this.showLoadingIndicator('Loading TIFF...');

            const tiffData = await this.fileParser.loadTIFF(fileGroup.file);

            // Convert TIFF to volume
            const volumeData = this.fileParser.convertTiffToVolume(tiffData);

            // Update UI
            this.fileName.textContent = fileGroup.name;

            this.hideLoadingIndicator();

            return volumeData;

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
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
