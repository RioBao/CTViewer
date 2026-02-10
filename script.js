class ImageViewer {
    constructor() {
        this.fileParser = new FileParser();
        this.ctViewer = null;
        this.histogram = null;
        this.cachedMid3DVolume = null;
        this.volumeState = this.createVolumeState();

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

        // 3D resolution controls
        this.resolution3DSelect = document.getElementById('resolution3DSelect');
        this.resolution3DStatus = document.getElementById('resolution3DStatus');

        this.applyFormatConfig();
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

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    handleKeyDown(e) {
        // Don't handle shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        switch (e.key) {
            case '+':
            case '=':
                e.preventDefault();
                this.zoomIn();
                break;
            case '-':
                e.preventDefault();
                this.zoomOut();
                break;
            case 'r':
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.resetView();
                }
                break;
            case 'c':
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.toggleCrosshairs();
                }
                break;
            case 'f':
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.toggleFullscreen();
                }
                break;
            case 'o':
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.fileInput.click();
                }
                break;
            case 'ArrowLeft':
                if (this.ctViewer && this.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.ctViewer.navigateSlice(this.ctViewer.state.activeView, -1);
                }
                break;
            case 'ArrowRight':
                if (this.ctViewer && this.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.ctViewer.navigateSlice(this.ctViewer.state.activeView, 1);
                }
                break;
            case 'ArrowUp':
                if (this.ctViewer && this.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.ctViewer.navigateSlice(this.ctViewer.state.activeView, -10);
                }
                break;
            case 'ArrowDown':
                if (this.ctViewer && this.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.ctViewer.navigateSlice(this.ctViewer.state.activeView, 10);
                }
                break;
            case 'Home':
                if (this.ctViewer && this.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.navigateToSliceEdge(this.ctViewer.state.activeView, 'first');
                }
                break;
            case 'End':
                if (this.ctViewer && this.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.navigateToSliceEdge(this.ctViewer.state.activeView, 'last');
                }
                break;
            case 'Escape':
                if (this.ctViewer && this.ctViewer.isRoiMode()) {
                    this.toggleRoiMode();
                }
                break;
        }
    }

    navigateToSliceEdge(axis, edge) {
        if (!this.ctViewer || !this.ctViewer.volumeData) return;
        const [nx, ny, nz] = this.ctViewer.volumeData.dimensions;
        const maxSlice = axis === 'xy' ? nz - 1 : axis === 'xz' ? ny - 1 : nx - 1;
        const target = edge === 'first' ? 0 : maxSlice;
        const current = this.ctViewer.state.slices[axis];
        this.ctViewer.navigateSlice(axis, target - current);
    }

    async handleFiles(files) {
        try {
            const fileArray = Array.from(files);
            const hasRaw = fileArray.some(file => this.fileParser.getFileExtension(file.name).toLowerCase() === 'raw');
            const hasJson = fileArray.some(file => this.fileParser.getFileExtension(file.name).toLowerCase() === 'json');
            const hasVolumeinfo = fileArray.some(file => {
                const name = file.name.toLowerCase();
                return name.endsWith('.raw.volumeinfo') || this.fileParser.getFileExtension(name) === 'volumeinfo';
            });
            const hasDat = fileArray.some(file => this.fileParser.getFileExtension(file.name).toLowerCase() === 'dat');

            // Group files by type (pairs .raw with .json, etc.)
            const fileGroups = await this.fileParser.groupFilesAsync(files);

            if (fileGroups.length === 0) {
                if (hasRaw && !hasJson && !hasVolumeinfo && !hasDat) {
                    alert('RAW file selected without metadata. Please select the matching .json, .raw.volumeinfo, or .dat file at the same time.');
                } else if (hasRaw) {
                    alert('RAW file selected without matching metadata. Ensure the .json, .raw.volumeinfo, or .dat has the same base name and select both files together.');
                } else {
                    alert('No valid files selected');
                }
                return;
            }

            const dicomGroups = fileGroups.filter(g => g.type === 'dicom-series');
            if (dicomGroups.length > 0) {
                let selected = dicomGroups[0];
                if (dicomGroups.length > 1) {
                    console.warn('Multiple DICOM series detected; auto-selecting the largest series');
                    selected = dicomGroups.reduce((best, current) => {
                        return (current.files.length > best.files.length) ? current : best;
                    }, dicomGroups[0]);
                }
                await this.loadDICOMSeries(selected);
                return;
            }

            const niftiGroup = fileGroups.find(g => g.type === 'nifti');
            if (niftiGroup) {
                await this.loadNifti(niftiGroup);
                return;
            }

            // Process first remaining group (for now, handle one dataset at a time)
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
        // Check if we're actually leaving the drop zone (not just entering a child)
        if (!this.dropZone.contains(e.relatedTarget)) {
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
            if (this.ctViewer && this.ctViewer.renderer3D) {
                this.ctViewer.renderer3D.setQuality(quality3DSelect.value);
            }
            quality3DSelect.addEventListener('change', (e) => {
                if (this.ctViewer && this.ctViewer.renderer3D) {
                    this.ctViewer.renderer3D.setQuality(e.target.value);
                }
            });
        }

        // 3D gamma slider
        const gamma3DSlider = document.getElementById('gamma3DSlider');
        const gamma3DValue = document.getElementById('gamma3DValue');
        if (gamma3DSlider) {
            gamma3DSlider.addEventListener('input', (e) => {
                const gamma = parseFloat(e.target.value);
                if (gamma3DValue) {
                    gamma3DValue.textContent = gamma.toFixed(1);
                }
                if (this.ctViewer && this.ctViewer.renderer3D) {
                    this.ctViewer.renderer3D.setGamma(gamma);
                }
            });
        }

        // 3D resolution selector
        if (this.resolution3DSelect) {
            this.resolution3DSelect.addEventListener('change', async (e) => {
                const value = e.target.value;
                await this.set3DResolution(value);
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

        // Listen for range change events (e.g., from ROI selection) to sync histogram
        document.addEventListener('rangechange', (e) => {
            const { min, max } = e.detail;
            if (this.histogram) {
                this.histogram.setRange(min, max);
            }
        });

        // Listen for crosshair position change events
        document.addEventListener('crosshairchange', (e) => {
            const { x, y, z, value } = e.detail;
            if (this.pixelInfo) {
                this.pixelInfo.textContent = `X: ${x}, Y: ${y}, Z: ${z} = ${value}`;
            }
        });
    }

    applyFormatConfig() {
        if (!this.fileInput) return;
        if (typeof ViewerConfig === 'undefined') return;
        const accept = ViewerConfig.accept;
        if (accept) {
            this.fileInput.accept = accept;
        }
    }

    createVolumeState() {
        return {
            name: '',
            dimensions: null,
            dataType: null,
            isStreaming: false,
            hasFullData: false,
            lowResVolume: null
        };
    }

    resetVolumeState() {
        this.volumeState = this.createVolumeState();
    }

    updateVolumeState(patch) {
        this.volumeState = { ...this.volumeState, ...patch };
    }

    updateVolumeUI({ name, dimensions, label, loading = false }) {
        if (!dimensions || dimensions.length !== 3) return;

        const [nx, ny, nz] = dimensions;
        const displayName = loading ? `${name} (loading...)` : name;

        if (this.fileName) {
            this.fileName.textContent = displayName || 'No file loaded';
        }
        if (this.imageInfo) {
            this.imageInfo.textContent = `${nx}x${ny}x${nz} | ${label}`;
        }

        if (this.sliceIndicatorXY) {
            this.sliceIndicatorXY.textContent = `XY: ${Math.floor(nz / 2) + 1}/${nz}`;
        }
        if (this.sliceIndicatorXZ) {
            this.sliceIndicatorXZ.textContent = `XZ: ${Math.floor(ny / 2) + 1}/${ny}`;
        }
        if (this.sliceIndicatorYZ) {
            this.sliceIndicatorYZ.textContent = `YZ: ${Math.floor(nx / 2) + 1}/${nx}`;
        }
    }

    reset3DResolutionCache() {
        this.cachedMid3DVolume = null;
    }

    update3DResolutionOptions(preferredValue = null) {
        const select = this.resolution3DSelect;
        if (!select) return;

        const ct = this.ctViewer;
        const renderer3D = ct ? ct.renderer3D : null;
        const gl = renderer3D ? renderer3D.gl : null;

        const state = this.volumeState || this.createVolumeState();
        const baseDims = state.dimensions;
        const lowVolume = state.lowResVolume;
        const lowDims = lowVolume ? lowVolume.dimensions : baseDims;

        const fullAvailable = !!baseDims && state.hasFullData && !state.isStreaming;
        const fullDims = fullAvailable ? baseDims : null;

        const dataType = state.dataType;

        const midAvailable = !!ct && typeof ct.canEnhance3D === 'function' && ct.canEnhance3D();
        const midDims = midAvailable && baseDims
            ? baseDims.map((value) => Math.ceil(value / 2))
            : null;

        const MAX_3D_MB = WebGLUtils.getVolumeStreamingThresholdBytes() / (1024 * 1024);

        const canUseDims = (dims) => {
            if (!dims) return { enabled: false, reason: 'Not available', reasonType: 'unavailable' };
            if (!gl || !dataType) return { enabled: true };
            const memCheck = WebGLUtils.checkGPUMemory(gl, dims, dataType);
            const memMB = memCheck && memCheck.memoryInfo
                ? parseFloat(memCheck.memoryInfo.gpuMegabytes)
                : 0;
            if (!memCheck.canLoad) {
                return { enabled: false, reason: memCheck.recommendation || 'Exceeds GPU limits', reasonType: 'memory' };
            }
            if (memMB && memMB > MAX_3D_MB) {
                return { enabled: false, reason: `~${memMB.toFixed(0)}MB exceeds ${MAX_3D_MB}MB limit`, reasonType: 'memory' };
            }
            return { enabled: true, warning: memCheck.recommendation };
        };

        const formatDims = (dims) => dims ? `${dims[0]}x${dims[1]}x${dims[2]}` : '';
        const applyOption = (value, label, state) => {
            const option = select.querySelector(`option[value="${value}"]`);
            if (!option) return;
            let text = label;
            if (!state.enabled && value === 'full' && state.reasonType === 'memory') {
                text = 'Full (Memory limited)';
            }
            option.textContent = text;
            option.disabled = !state.enabled;
            option.title = state.reason || '';
        };

        const lowState = canUseDims(lowDims);
        const midState = midAvailable ? canUseDims(midDims) : { enabled: false, reason: 'Not available' };
        const fullState = fullAvailable ? canUseDims(fullDims) : { enabled: false, reason: 'Not available' };

        const lowLabelDims = lowVolume ? lowDims : null;
        applyOption('low', lowLabelDims ? `Low (${formatDims(lowLabelDims)})` : 'Low', lowState);
        applyOption('mid', midDims ? `Mid (${formatDims(midDims)})` : 'Mid', midState);
        applyOption('full', fullDims ? `Full (${formatDims(fullDims)})` : 'Full', fullState);

        let desired = preferredValue || select.value;
        const currentOption = select.querySelector(`option[value="${desired}"]`);
        if (!currentOption || currentOption.disabled) {
            const firstEnabled = Array.from(select.options).find((opt) => !opt.disabled);
            desired = firstEnabled ? firstEnabled.value : select.value;
        }

        if (desired && select.value !== desired) {
            select.value = desired;
        }

        if (this.resolution3DStatus) {
            this.resolution3DStatus.textContent = '';
        }
    }

    async set3DResolution(value) {
        if (!this.ctViewer || !this.ctViewer.renderer3D) return;

        if (this.resolution3DStatus) {
            this.resolution3DStatus.textContent = '';
        }

        if (value === 'low') {
            const lowVolume = (this.volumeState && this.volumeState.lowResVolume) || this.ctViewer.volumeData;
            if (lowVolume) {
                this.ctViewer.renderer3D.loadVolume(lowVolume);
            }
            return;
        }

        if (value === 'mid') {
            if (this.cachedMid3DVolume) {
                this.ctViewer.renderer3D.loadVolume(this.cachedMid3DVolume);
                return;
            }

            if (!this.ctViewer.canEnhance3D || !this.ctViewer.canEnhance3D()) {
                return;
            }

            if (this.resolution3DSelect) {
                this.resolution3DSelect.disabled = true;
            }
            if (this.resolution3DStatus) {
                this.resolution3DStatus.textContent = '0%';
            }

            const success = await this.ctViewer.enhance3D((progress) => {
                if (this.resolution3DStatus) {
                    this.resolution3DStatus.textContent = `${progress}%`;
                }
            });

            if (this.resolution3DSelect) {
                this.resolution3DSelect.disabled = false;
            }

            if (success) {
                this.cachedMid3DVolume = this.ctViewer.renderer3D.volumeData;
                if (this.resolution3DStatus) {
                    this.resolution3DStatus.textContent = '';
                }
            } else if (this.resolution3DStatus) {
                this.resolution3DStatus.textContent = 'Failed';
            }
            return;
        }

        if (value === 'full') {
            let fullVolume = null;
            if (this.ctViewer.progressiveVolume &&
                typeof this.ctViewer.progressiveVolume.getFullVolumeData === 'function') {
                fullVolume = this.ctViewer.progressiveVolume.getFullVolumeData();
            } else if (this.ctViewer.volumeData) {
                fullVolume = this.ctViewer.volumeData;
            }

            if (fullVolume) {
                this.ctViewer.renderer3D.loadVolume(fullVolume);
            }
        }
    }

    async loadCTVolume(fileGroup) {
        try {
            this.reset3DResolutionCache();
            this.resetVolumeState();

            // Show loading indicator
            this.showLoadingIndicator('Loading 3D volume...');

            // Use progressive loading for large files
            const PROGRESSIVE_THRESHOLD = (typeof ViewerConfig !== 'undefined' &&
                ViewerConfig.limits &&
                Number.isFinite(ViewerConfig.limits.progressiveThresholdBytes))
                ? ViewerConfig.limits.progressiveThresholdBytes
                : 50 * 1024 * 1024;
            const useProgressive = fileGroup.rawFile.size > PROGRESSIVE_THRESHOLD;

            if (useProgressive) {
                await this.loadCTVolumeProgressive(fileGroup);
            } else {
                await this.loadCTVolumeDirect(fileGroup);
            }

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    /**
     * Load volume directly (for smaller files)
     */
    async loadCTVolumeDirect(fileGroup) {
        const volumeData = await this.fileParser.load3DVolume(
            fileGroup.rawFile,
            fileGroup.jsonFile,
            (progress) => {
                this.updateLoadingProgress(progress);
            },
            fileGroup.volumeinfoFile,
            fileGroup.datFile
        );

        // Switch to CT mode
        this.switchToCTMode();

        // Load volume into CT viewer
        const info = this.ctViewer.loadVolume(volumeData);

        this.updateVolumeState({
            name: fileGroup.name,
            dimensions: info.dimensions,
            dataType: info.dataType,
            isStreaming: false,
            hasFullData: true,
            lowResVolume: null
        });
        this.update3DResolutionOptions('full');

        // Initialize histogram with volume data
        if (this.histogram) {
            this.histogram.setVolume(volumeData);
        }

        // Update UI
        this.updateVolumeUI({
            name: fileGroup.name,
            dimensions: info.dimensions,
            label: info.dataType
        });

        // Hide loading indicator
        this.hideLoadingIndicator();
    }

    /**
     * Load volume progressively with Z-axis tiling (for larger files)
     */
    async loadCTVolumeProgressive(fileGroup) {
        console.log('Using progressive loading for large volume');

        // Switch to CT mode early so views are ready
        this.switchToCTMode();

        // Reference to store progressive data when it's created
        let progressiveData = null;

        // Create callbacks
        const callbacks = {
            onProgress: (progress) => {
                this.updateLoadingProgress(progress);
            },
            onLowResReady: (lowResVolume, progData) => {
                // Store reference to progressive data
                progressiveData = progData;
                this.ctViewer.progressiveVolume = progData;
                this.ctViewer.volumeData = progData;

                // Set up callbacks for streaming mode to re-render when slices load
                if (progData.isStreaming) {
                    // XY slice ready callback
                    progData.onSliceReady = (z) => {
                        // Only re-render if this is the current slice (exact match)
                        const currentZ = this.ctViewer.state.slices.xy;
                        if (z === currentZ) {
                            this.ctViewer.renderView('xy', z);
                            if (this.ctViewer.crosshairEnabled) {
                                this.ctViewer.drawCrosshairs();
                            }
                        }
                    };

                    // XZ slice ready callback
                    progData.onXZSliceReady = (y) => {
                        const currentY = this.ctViewer.state.slices.xz;
                        if (y === currentY) {
                            this.ctViewer.renderView('xz', y);
                            if (this.ctViewer.crosshairEnabled) {
                                this.ctViewer.drawCrosshairs();
                            }
                        }
                    };

                    // YZ slice ready callback
                    progData.onYZSliceReady = (x) => {
                        const currentX = this.ctViewer.state.slices.yz;
                        if (x === currentX) {
                            this.ctViewer.renderView('yz', x);
                            if (this.ctViewer.crosshairEnabled) {
                                this.ctViewer.drawCrosshairs();
                            }
                        }
                    };
                }

                // Update state and UI immediately with low-res preview
                this.updateVolumeState({
                    name: fileGroup.name,
                    dimensions: progData.dimensions,
                    dataType: progData.dataType,
                    isStreaming: !!progData.isStreaming,
                    hasFullData: false,
                    lowResVolume: lowResVolume
                });
                this.updateVolumeUI({
                    name: fileGroup.name,
                    dimensions: progData.dimensions,
                    label: 'Progressive',
                    loading: true
                });

                // Initialize histogram with progressive data
                if (this.histogram) {
                    this.histogram.setVolume(progData);
                }

                this.update3DResolutionOptions('low');

                // Hide loading indicator - user can interact now
                this.hideLoadingIndicator();

                // Call CTViewer's handler
                this.ctViewer.handleLowResReady(lowResVolume);
            },
            onBlockReady: (blockIndex, zStart, zEnd) => {
                // Call CTViewer's handler
                this.ctViewer.handleBlockReady(blockIndex, zStart, zEnd);
            },
            onFullDataReady: (newVolumeData) => {
                // Hybrid mode: full data loaded, swap from streaming to in-memory
                progressiveData = newVolumeData;
                this.ctViewer.progressiveVolume = newVolumeData;
                this.ctViewer.volumeData = newVolumeData;
                this.updateVolumeState({
                    hasFullData: true,
                    isStreaming: false
                });

                // Re-render views with high-res data in a staggered way to avoid UI stalls
                const schedule = (cb) => {
                    if (typeof requestAnimationFrame === 'function') {
                        requestAnimationFrame(cb);
                    } else {
                        setTimeout(cb, 0);
                    }
                };

                this.ctViewer.renderView('xy');

                if (!this.ctViewer.singleViewMode) {
                    schedule(() => {
                        this.ctViewer.renderView('xz');
                        schedule(() => {
                            this.ctViewer.renderView('yz');
                            if (this.ctViewer.crosshairEnabled) {
                                this.ctViewer.drawCrosshairs();
                            }
                        });
                    });
                } else if (this.ctViewer.crosshairEnabled) {
                    this.ctViewer.drawCrosshairs();
                }

                // Skip histogram update — low-res histogram is already adequate
                // and recomputing from ~695M voxels freezes the UI for seconds

                console.log('Hybrid mode: Swapped to in-memory volume data');
            },
            onAllBlocksReady: () => {
                // Update UI to show loading complete
                this.updateVolumeState({
                    name: fileGroup.name,
                    dimensions: progressiveData.dimensions,
                    dataType: progressiveData.dataType,
                    hasFullData: !this.volumeState.isStreaming
                });
                this.updateVolumeUI({
                    name: fileGroup.name,
                    dimensions: progressiveData.dimensions,
                    label: progressiveData.dataType
                });

                // Call CTViewer's handler
                this.ctViewer.handleAllBlocksReady();

                this.update3DResolutionOptions();

                console.log('Progressive loading complete');
            }
        };

        // Start progressive loading
        await this.fileParser.load3DVolumeProgressive(
            fileGroup.rawFile,
            fileGroup.jsonFile,
            callbacks,
            fileGroup.volumeinfoFile,
            fileGroup.datFile
        );
    }

    async loadDICOMSeries(seriesGroup) {
        try {
            this.reset3DResolutionCache();
            this.resetVolumeState();
            this.showLoadingIndicator('Loading DICOM series...');

            const volumeData = await this.fileParser.loadDICOMSeries(
                seriesGroup,
                (progress) => {
                    this.updateLoadingProgress(progress);
                }
            );

            // Switch to CT mode
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);
            this.updateVolumeState({
                name: seriesGroup.name || 'DICOM Series',
                dimensions: info.dimensions,
                dataType: info.dataType,
                isStreaming: false,
                hasFullData: true,
                lowResVolume: null
            });
            this.update3DResolutionOptions('full');

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.updateVolumeUI({
                name: seriesGroup.name || 'DICOM Series',
                dimensions: info.dimensions,
                label: `DICOM ${info.dataType}`
            });

            this.hideLoadingIndicator();
        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    async loadNifti(fileGroup) {
        try {
            this.reset3DResolutionCache();
            this.resetVolumeState();
            this.showLoadingIndicator('Loading NIfTI...');

            const volumeData = await this.fileParser.loadNifti(fileGroup.file);

            // Switch to CT mode
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);
            this.updateVolumeState({
                name: fileGroup.name || 'NIfTI',
                dimensions: info.dimensions,
                dataType: info.dataType,
                isStreaming: false,
                hasFullData: true,
                lowResVolume: null
            });
            this.update3DResolutionOptions('full');

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.updateVolumeUI({
                name: fileGroup.name || 'NIfTI',
                dimensions: info.dimensions,
                label: `NIfTI ${info.dataType}`
            });

            this.hideLoadingIndicator();
        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    async loadTIFF(fileGroup) {
        try {
            this.reset3DResolutionCache();
            this.resetVolumeState();
            this.showLoadingIndicator('Loading TIFF...');

            const tiffData = await this.fileParser.loadTIFF(fileGroup.file);

            // Convert TIFF to VolumeData (treats 2D as depth=1 volume)
            const volumeData = this.fileParser.convertTiffToVolume(tiffData);

            // Switch to CT mode and display
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);
            this.updateVolumeState({
                name: fileGroup.name,
                dimensions: info.dimensions,
                dataType: info.dataType,
                isStreaming: false,
                hasFullData: true,
                lowResVolume: null
            });
            this.update3DResolutionOptions('full');

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.updateVolumeUI({
                name: fileGroup.name,
                dimensions: info.dimensions,
                label: info.dataType
            });

            this.hideLoadingIndicator();

        } catch (error) {
            this.hideLoadingIndicator();
            throw error;
        }
    }

    async load2DImage(fileGroup) {
        try {
            this.reset3DResolutionCache();
            this.resetVolumeState();
            this.showLoadingIndicator('Loading image...');

            const file = fileGroup.file;
            const volumeData = await this.convertImageToVolume(file);

            // Switch to CT mode and display
            this.switchToCTMode();

            // Load volume into CT viewer
            const info = this.ctViewer.loadVolume(volumeData);
            this.updateVolumeState({
                name: file.name,
                dimensions: info.dimensions,
                dataType: info.dataType,
                isStreaming: false,
                hasFullData: true,
                lowResVolume: null
            });
            this.update3DResolutionOptions('full');

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.updateVolumeUI({
                name: file.name,
                dimensions: info.dimensions,
                label: info.dataType
            });

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
            } else if (progress.stage === 'streaming') {
                progressEl.textContent = 'Streaming mode: Creating preview...';
            } else if (progress.stage === 'parsing' || progress.stage === 'processing') {
                progressEl.textContent = 'Processing volume data...';
            } else if (progress.stage === 'complete') {
                progressEl.textContent = 'Complete!';
            }
        }
    }

}

// Initialize the viewer
const viewer = new ImageViewer();
