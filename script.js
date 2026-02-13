class ImageViewer {
    constructor() {
        this.fileParser = new FileParser();
        this.ctViewer = null;
        this.histogram = null;
        this.cachedMid3DVolume = null;
        this.fileHandleMap = new Map();
        this.pendingRawSelection = null;
        this.volumeState = this.createVolumeState();
        this.ui = this.createUIState();

        this.initElements();
        this.status = new ViewerStatus(this);
        this.controls = new ViewerControls(this);
        this.loaders = {
            raw: new RawVolumeLoader(this),
            dicom: new DicomSeriesLoader(this),
            nifti: new NiftiVolumeLoader(this),
            tiff: new TiffVolumeLoader(this)
        };

        this.status.applyFormatConfig();
        this.initCTComponents();
        this.status.bind();
        this.controls.bind();
        this.bindOverlayUI();
        this.update3DStatusChip();
    }

    clearSelectedFileHandles() {
        this.fileHandleMap.clear();
    }

    getFileSignature(file) {
        if (!file) return '';
        const name = file.name || '';
        const size = Number.isFinite(file.size) ? file.size : 0;
        const modified = Number.isFinite(file.lastModified) ? file.lastModified : 0;
        return `${name}::${size}::${modified}`;
    }

    rememberSelectedFileHandles(files, handles) {
        this.clearSelectedFileHandles();
        if (!Array.isArray(files) || !Array.isArray(handles) || files.length !== handles.length) {
            return;
        }
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const handle = handles[i];
            if (!file || !handle || handle.kind !== 'file') continue;
            const key = this.getFileSignature(file);
            if (key) {
                this.fileHandleMap.set(key, handle);
            }
        }
    }

    getFileHandle(file) {
        if (!file) return null;
        const key = this.getFileSignature(file);
        if (!key) return null;
        return this.fileHandleMap.get(key) || null;
    }

    clearPendingRawSelection() {
        this.pendingRawSelection = null;
    }

    rememberPendingRawSelection(rawFile) {
        if (!rawFile) return;
        this.pendingRawSelection = {
            file: rawFile,
            createdAt: Date.now()
        };
    }

    hasPendingRawSelection() {
        if (!this.pendingRawSelection || !this.pendingRawSelection.file) {
            return false;
        }
        const ageMs = Date.now() - (this.pendingRawSelection.createdAt || 0);
        if (ageMs > 10 * 60 * 1000) {
            this.clearPendingRawSelection();
            return false;
        }
        return true;
    }

    isRawFile(file) {
        if (!file || !file.name) return false;
        const ext = this.fileParser.getFileExtension(file.name).toLowerCase();
        return ext === 'raw';
    }

    isRawMetadataFile(file) {
        if (!file || !file.name) return false;
        const ext = this.fileParser.getFileExtension(file.name).toLowerCase();
        return ext === 'json' || ext === 'dat' || ext === 'volumeinfo';
    }

    hasAnyRawMetadata(files) {
        return files.some((f) => this.isRawMetadataFile(f));
    }

    tryMergeWithPendingRawSelection(fileArray) {
        if (!this.hasPendingRawSelection() || !Array.isArray(fileArray) || fileArray.length === 0) {
            return fileArray;
        }

        const hasRaw = fileArray.some((f) => this.isRawFile(f));
        if (hasRaw) {
            // New RAW selection supersedes previous pending state.
            this.clearPendingRawSelection();
            return fileArray;
        }

        const metadataFiles = fileArray.filter((f) => this.isRawMetadataFile(f));
        if (metadataFiles.length > 0) {
            const merged = [this.pendingRawSelection.file, ...fileArray];
            this.clearPendingRawSelection();
            return merged;
        }

        return fileArray;
    }

    async openFilesDialog() {
        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const handles = await window.showOpenFilePicker({ multiple: true });
                if (!handles || handles.length === 0) return;

                const files = [];
                for (const handle of handles) {
                    if (handle && handle.kind === 'file') {
                        files.push(await handle.getFile());
                    }
                }
                if (files.length === 0) return;

                this.rememberSelectedFileHandles(files, handles);
                await this.handleFiles(files);
                return;
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    return;
                }
                console.warn('showOpenFilePicker unavailable/failed, falling back to file input:', error);
            }
        }

        this.clearSelectedFileHandles();
        if (this.fileInput) {
            this.fileInput.click();
        }
    }

    initElements() {
        // Common UI elements
        this.placeholder = document.getElementById('placeholder');
        this.fileInput = document.getElementById('fileInput');
        this.dropZone = document.getElementById('dropZone');
        this.fileName = document.getElementById('fileName');
        this.imageInfo = document.getElementById('imageInfo');
        this.zoomLevel = document.getElementById('zoomLevel');
        this.footerInfoPanel = document.getElementById('footerInfoPanel');
        this.footerInfoGrid = document.getElementById('footerInfoGrid');

        // Overlay UI elements
        this.topOverlay = document.getElementById('topOverlay');
        this.toolDock = document.getElementById('toolDock');
        this.toolDockGrip = document.getElementById('toolDockGrip');
        this.dockLogoBtn = document.getElementById('dockLogoBtn');
        this.aboutPopover = document.getElementById('aboutPopover');
        this.histogramOverlay = document.getElementById('histogramOverlay');
        this.histogramGrip = document.getElementById('histogramGrip');
        this.histogramToggleBtn = document.getElementById('histogramToggleBtn');
        this.histogramPinBtn = document.getElementById('histogramPinBtn');
        this.histogramCloseBtn = document.getElementById('histogramCloseBtn');
        this.sliceControls = document.getElementById('sliceControls');
        this.sliceGrip = document.getElementById('sliceGrip');

        this.viewport3DControls = document.getElementById('viewport3DControls');
        this.viewport3DChip = document.getElementById('viewport3DChip');
        this.viewport3DPanel = document.getElementById('viewport3DPanel');
        this.resolutionChipText = document.getElementById('resolutionChipText');

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
    }

    createUIState() {
        return {
            histogramOpen: false,
            histogramPinned: false,
            aboutOpen: false,
            footerInfoOpen: false,
            crosshairEnabled: false,
            threeDPanelOpen: false,
            toolDockDragging: false,
            toolDockStartX: 0,
            toolDockStartY: 0,
            toolDockStartLeft: 16,
            toolDockStartTop: 80,
            histogramDragging: false,
            histogramStartX: 0,
            histogramStartY: 0,
            histogramStartLeft: 0,
            histogramStartTop: 80,
            sliceDragging: false,
            sliceStartX: 0,
            sliceStartY: 0,
            sliceStartLeft: 16,
            sliceStartTop: 0,
            topOverlayTimer: null,
            threeDControlsTimer: null
        };
    }

    bindOverlayUI() {
        if (this.dockLogoBtn) {
            this.dockLogoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleAboutPopover();
            });
        }

        if (this.aboutPopover) {
            this.aboutPopover.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        if (this.histogramToggleBtn) {
            this.histogramToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleHistogramOverlay();
            });
        }

        if (this.histogramCloseBtn) {
            this.histogramCloseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.setHistogramOpen(false);
            });
        }

        if (this.histogramPinBtn) {
            this.histogramPinBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleHistogramPin();
            });
        }

        if (this.histogramOverlay) {
            this.histogramOverlay.addEventListener('mousedown', (e) => e.stopPropagation());
        }
        if (this.sliceControls) {
            this.sliceControls.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        if (this.viewport3DChip) {
            this.viewport3DChip.addEventListener('mousedown', (e) => e.stopPropagation());
            this.viewport3DChip.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggle3DPanel();
            });
        }

        if (this.viewport3DPanel) {
            this.viewport3DPanel.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        if (this.imageInfo) {
            this.imageInfo.classList.add('info-trigger');
            this.imageInfo.setAttribute('tabindex', '0');
            this.imageInfo.setAttribute('role', 'button');
            this.imageInfo.setAttribute('aria-haspopup', 'dialog');
            this.imageInfo.setAttribute('aria-expanded', 'false');
            this.imageInfo.setAttribute('title', 'Show technical details');
            this.imageInfo.addEventListener('mousedown', (e) => e.stopPropagation());
            this.imageInfo.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleFooterInfoPanel();
            });
            this.imageInfo.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleFooterInfoPanel();
                }
            });
        }

        if (this.footerInfoPanel) {
            this.footerInfoPanel.addEventListener('mousedown', (e) => e.stopPropagation());
        }

        document.addEventListener('mousedown', (e) => {
            const target = e.target;

            if (this.ui.aboutOpen &&
                this.aboutPopover &&
                !this.aboutPopover.contains(target) &&
                this.dockLogoBtn &&
                !this.dockLogoBtn.contains(target)) {
                this.setAboutOpen(false);
            }

            if (this.ui.histogramOpen &&
                !this.ui.histogramPinned &&
                this.histogramOverlay &&
                !this.histogramOverlay.contains(target) &&
                this.histogramToggleBtn &&
                !this.histogramToggleBtn.contains(target)) {
                this.setHistogramOpen(false);
            }

            if (this.ui.threeDPanelOpen &&
                this.viewport3DControls &&
                !this.viewport3DControls.contains(target)) {
                this.set3DPanelOpen(false);
            }

            if (this.ui.footerInfoOpen &&
                this.footerInfoPanel &&
                !this.footerInfoPanel.contains(target) &&
                this.imageInfo &&
                !this.imageInfo.contains(target)) {
                this.setFooterInfoOpen(false);
            }
        });

        window.addEventListener('resize', () => {
            if (this.ui.aboutOpen) {
                this.positionAboutPopover();
            }
            if (this.ui.histogramOpen) {
                this.refreshHistogramOverlay();
            }
            this.clampToolDockPosition();
            this.clampHistogramPosition();
            this.clampSliceOverlayPosition();
            this.update3DStatusChip();
        });

        this.bindTopOverlayBehavior();
        this.bind3DOverlayBehavior();
        this.bindToolDockDrag();
        this.bindHistogramDrag();
        this.bindSliceOverlayDrag();
        this.setAboutOpen(false);
        this.setHistogramOpen(false);
        this.set3DPanelOpen(false);
        this.setFooterInfoOpen(false);
    }

    bindTopOverlayBehavior() {
        if (!this.topOverlay) return;

        const showTopOverlay = () => {
            this.topOverlay.classList.add('reveal');
            if (this.ui.topOverlayTimer) {
                clearTimeout(this.ui.topOverlayTimer);
            }
            this.ui.topOverlayTimer = setTimeout(() => {
                if (!this.topOverlay.matches(':hover')) {
                    this.topOverlay.classList.remove('reveal');
                }
            }, 1500);
        };

        document.addEventListener('mousemove', (e) => {
            if (e.clientY <= 72) {
                showTopOverlay();
            }
        });

        this.topOverlay.addEventListener('mouseenter', () => {
            this.topOverlay.classList.add('reveal');
            if (this.ui.topOverlayTimer) {
                clearTimeout(this.ui.topOverlayTimer);
            }
        });

        this.topOverlay.addEventListener('mouseleave', () => {
            if (this.ui.topOverlayTimer) {
                clearTimeout(this.ui.topOverlayTimer);
            }
            this.ui.topOverlayTimer = setTimeout(() => {
                this.topOverlay.classList.remove('reveal');
            }, 700);
        });

        showTopOverlay();
    }

    bind3DOverlayBehavior() {
        if (!this.canvas3D || !this.viewport3DControls) return;

        const viewport3DContainer = this.canvas3D.parentElement;
        if (!viewport3DContainer) return;

        const activateControls = () => {
            this.set3DControlsActive(true);
            this.schedule3DControlsFade();
        };

        viewport3DContainer.addEventListener('mouseenter', activateControls);
        viewport3DContainer.addEventListener('mousemove', activateControls);
        viewport3DContainer.addEventListener('mouseleave', () => {
            if (!this.ui.threeDPanelOpen) {
                this.set3DControlsActive(false);
            }
        });

        this.viewport3DControls.addEventListener('mouseenter', () => {
            this.set3DControlsActive(true);
        });

        this.viewport3DControls.addEventListener('mouseleave', () => {
            if (!this.ui.threeDPanelOpen) {
                this.schedule3DControlsFade();
            }
        });
    }

    bindToolDockDrag() {
        if (!this.toolDock || !this.toolDockGrip || !this.dropZone) return;

        let savedLeft = NaN;
        let savedTop = NaN;
        try {
            savedLeft = parseInt(localStorage.getItem('viewer.toolDock.left') || '', 10);
            savedTop = parseInt(localStorage.getItem('viewer.toolDock.top') || '', 10);
        } catch (error) {
            // Ignore storage read failures.
        }
        if (Number.isFinite(savedLeft) && Number.isFinite(savedTop)) {
            this.setToolDockPosition(savedLeft, savedTop, false);
        } else {
            this.clampToolDockPosition();
        }

        const onPointerMove = (e) => {
            if (!this.ui.toolDockDragging) return;
            e.preventDefault();
            const nextLeft = this.ui.toolDockStartLeft + (e.clientX - this.ui.toolDockStartX);
            const nextTop = this.ui.toolDockStartTop + (e.clientY - this.ui.toolDockStartY);
            this.setToolDockPosition(nextLeft, nextTop, false);
        };

        const onPointerUp = () => {
            if (!this.ui.toolDockDragging) return;
            this.ui.toolDockDragging = false;
            this.toolDock.classList.remove('dragging');
            this.persistToolDockPosition();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };

        this.toolDockGrip.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const containerRect = this.dropZone.getBoundingClientRect();
            const dockRect = this.toolDock.getBoundingClientRect();
            this.ui.toolDockDragging = true;
            this.ui.toolDockStartX = e.clientX;
            this.ui.toolDockStartY = e.clientY;
            this.ui.toolDockStartLeft = dockRect.left - containerRect.left;
            this.ui.toolDockStartTop = dockRect.top - containerRect.top;

            this.toolDock.classList.add('dragging');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });
    }

    setToolDockPosition(left, top, persist = true) {
        if (!this.toolDock || !this.dropZone) return;

        const containerRect = this.dropZone.getBoundingClientRect();
        const dockRect = this.toolDock.getBoundingClientRect();
        const maxLeft = Math.max(8, containerRect.width - dockRect.width - 8);
        const maxTop = Math.max(56, containerRect.height - dockRect.height - 8);

        const clampedLeft = Math.max(8, Math.min(maxLeft, left));
        const clampedTop = Math.max(56, Math.min(maxTop, top));

        this.toolDock.style.left = `${Math.round(clampedLeft)}px`;
        this.toolDock.style.top = `${Math.round(clampedTop)}px`;

        if (this.ui.aboutOpen) {
            this.positionAboutPopover();
        }

        if (persist) {
            this.persistToolDockPosition();
        }
    }

    clampToolDockPosition() {
        if (!this.toolDock) return;

        const left = parseFloat(this.toolDock.style.left || '16');
        const top = parseFloat(this.toolDock.style.top || '80');
        this.setToolDockPosition(left, top, false);
    }

    persistToolDockPosition() {
        if (!this.toolDock) return;
        try {
            localStorage.setItem('viewer.toolDock.left', `${Math.round(parseFloat(this.toolDock.style.left || '16'))}`);
            localStorage.setItem('viewer.toolDock.top', `${Math.round(parseFloat(this.toolDock.style.top || '80'))}`);
        } catch (error) {
            // Persistence is optional; ignore storage failures.
        }
    }

    bindHistogramDrag() {
        if (!this.histogramOverlay || !this.histogramGrip || !this.dropZone) return;

        let savedLeft = NaN;
        let savedTop = NaN;
        try {
            savedLeft = parseInt(localStorage.getItem('viewer.histogram.left') || '', 10);
            savedTop = parseInt(localStorage.getItem('viewer.histogram.top') || '', 10);
        } catch (error) {
            // Ignore storage read failures.
        }

        if (Number.isFinite(savedLeft) && Number.isFinite(savedTop)) {
            this.setHistogramOverlayPosition(savedLeft, savedTop, false);
        }

        const onPointerMove = (e) => {
            if (!this.ui.histogramDragging) return;
            e.preventDefault();
            const nextLeft = this.ui.histogramStartLeft + (e.clientX - this.ui.histogramStartX);
            const nextTop = this.ui.histogramStartTop + (e.clientY - this.ui.histogramStartY);
            this.setHistogramOverlayPosition(nextLeft, nextTop, false);
        };

        const onPointerUp = () => {
            if (!this.ui.histogramDragging) return;
            this.ui.histogramDragging = false;
            this.histogramOverlay.classList.remove('dragging');
            this.persistHistogramOverlayPosition();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };

        this.histogramGrip.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const containerRect = this.dropZone.getBoundingClientRect();
            const overlayRect = this.histogramOverlay.getBoundingClientRect();
            this.ui.histogramDragging = true;
            this.ui.histogramStartX = e.clientX;
            this.ui.histogramStartY = e.clientY;
            this.ui.histogramStartLeft = overlayRect.left - containerRect.left;
            this.ui.histogramStartTop = overlayRect.top - containerRect.top;

            this.histogramOverlay.classList.add('dragging');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });
    }

    setHistogramOverlayPosition(left, top, persist = true) {
        if (!this.histogramOverlay || !this.dropZone) return;

        const containerRect = this.dropZone.getBoundingClientRect();
        const panelWidth = this.histogramOverlay.offsetWidth || 260;
        const panelHeight = this.histogramOverlay.offsetHeight || 170;
        const maxLeft = Math.max(8, containerRect.width - panelWidth - 8);
        const maxTop = Math.max(56, containerRect.height - panelHeight - 8);

        const clampedLeft = Math.max(8, Math.min(maxLeft, left));
        const clampedTop = Math.max(56, Math.min(maxTop, top));

        this.histogramOverlay.style.left = `${Math.round(clampedLeft)}px`;
        this.histogramOverlay.style.top = `${Math.round(clampedTop)}px`;
        this.histogramOverlay.style.right = 'auto';

        if (persist) {
            this.persistHistogramOverlayPosition();
        }
    }

    clampHistogramPosition() {
        if (!this.histogramOverlay) return;
        if (!this.histogramOverlay.style.left) return;

        const left = parseFloat(this.histogramOverlay.style.left || '0');
        const top = parseFloat(this.histogramOverlay.style.top || '80');
        this.setHistogramOverlayPosition(left, top, false);
    }

    persistHistogramOverlayPosition() {
        if (!this.histogramOverlay || !this.histogramOverlay.style.left) return;
        try {
            localStorage.setItem('viewer.histogram.left', `${Math.round(parseFloat(this.histogramOverlay.style.left || '0'))}`);
            localStorage.setItem('viewer.histogram.top', `${Math.round(parseFloat(this.histogramOverlay.style.top || '80'))}`);
        } catch (error) {
            // Persistence is optional; ignore storage failures.
        }
    }

    bindSliceOverlayDrag() {
        if (!this.sliceControls || !this.sliceGrip || !this.dropZone) return;

        let savedLeft = NaN;
        let savedTop = NaN;
        try {
            savedLeft = parseInt(localStorage.getItem('viewer.sliceOverlay.left') || '', 10);
            savedTop = parseInt(localStorage.getItem('viewer.sliceOverlay.top') || '', 10);
        } catch (error) {
            // Ignore storage read failures.
        }
        if (Number.isFinite(savedLeft) && Number.isFinite(savedTop)) {
            this.setSliceOverlayPosition(savedLeft, savedTop, false);
        }

        const onPointerMove = (e) => {
            if (!this.ui.sliceDragging) return;
            e.preventDefault();
            const nextLeft = this.ui.sliceStartLeft + (e.clientX - this.ui.sliceStartX);
            const nextTop = this.ui.sliceStartTop + (e.clientY - this.ui.sliceStartY);
            this.setSliceOverlayPosition(nextLeft, nextTop, false);
        };

        const onPointerUp = () => {
            if (!this.ui.sliceDragging) return;
            this.ui.sliceDragging = false;
            this.sliceControls.classList.remove('dragging');
            this.persistSliceOverlayPosition();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };

        this.sliceGrip.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const containerRect = this.dropZone.getBoundingClientRect();
            const overlayRect = this.sliceControls.getBoundingClientRect();
            this.ui.sliceDragging = true;
            this.ui.sliceStartX = e.clientX;
            this.ui.sliceStartY = e.clientY;
            this.ui.sliceStartLeft = overlayRect.left - containerRect.left;
            this.ui.sliceStartTop = overlayRect.top - containerRect.top;

            this.sliceControls.classList.add('dragging');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
        });
    }

    setSliceOverlayPosition(left, top, persist = true) {
        if (!this.sliceControls || !this.dropZone) return;

        const containerRect = this.dropZone.getBoundingClientRect();
        const panelWidth = this.sliceControls.offsetWidth || 260;
        const panelHeight = this.sliceControls.offsetHeight || 34;
        const maxLeft = Math.max(8, containerRect.width - panelWidth - 8);
        const maxTop = Math.max(8, containerRect.height - panelHeight - 8);

        const clampedLeft = Math.max(8, Math.min(maxLeft, left));
        const clampedTop = Math.max(8, Math.min(maxTop, top));

        this.sliceControls.style.left = `${Math.round(clampedLeft)}px`;
        this.sliceControls.style.top = `${Math.round(clampedTop)}px`;
        this.sliceControls.style.bottom = 'auto';
        this.sliceControls.style.right = 'auto';

        if (persist) {
            this.persistSliceOverlayPosition();
        }
    }

    clampSliceOverlayPosition() {
        if (!this.sliceControls) return;
        if (!this.sliceControls.style.left || !this.sliceControls.style.top) return;

        const left = parseFloat(this.sliceControls.style.left || '16');
        const top = parseFloat(this.sliceControls.style.top || '16');
        this.setSliceOverlayPosition(left, top, false);
    }

    persistSliceOverlayPosition() {
        if (!this.sliceControls || !this.sliceControls.style.left) return;
        try {
            localStorage.setItem('viewer.sliceOverlay.left', `${Math.round(parseFloat(this.sliceControls.style.left || '16'))}`);
            localStorage.setItem('viewer.sliceOverlay.top', `${Math.round(parseFloat(this.sliceControls.style.top || '16'))}`);
        } catch (error) {
            // Persistence is optional; ignore storage failures.
        }
    }

    set3DControlsActive(active) {
        if (!this.viewport3DControls) return;
        this.viewport3DControls.classList.toggle('active', !!active);
    }

    schedule3DControlsFade() {
        if (this.ui.threeDControlsTimer) {
            clearTimeout(this.ui.threeDControlsTimer);
        }

        this.ui.threeDControlsTimer = setTimeout(() => {
            if (!this.ui.threeDPanelOpen) {
                this.set3DControlsActive(false);
            }
        }, 2000);
    }

    set3DPanelOpen(open) {
        this.ui.threeDPanelOpen = !!open;

        if (this.viewport3DControls) {
            this.viewport3DControls.classList.toggle('expanded', this.ui.threeDPanelOpen);
        }

        if (this.viewport3DPanel) {
            this.viewport3DPanel.setAttribute('aria-hidden', this.ui.threeDPanelOpen ? 'false' : 'true');
        }

        this.set3DControlsActive(true);
        if (!this.ui.threeDPanelOpen) {
            this.schedule3DControlsFade();
        }
    }

    toggle3DPanel(forceOpen = null) {
        const next = forceOpen === null ? !this.ui.threeDPanelOpen : !!forceOpen;
        this.set3DPanelOpen(next);
    }

    setAboutOpen(open) {
        this.ui.aboutOpen = !!open;

        if (this.aboutPopover) {
            this.aboutPopover.classList.toggle('open', this.ui.aboutOpen);
            this.aboutPopover.setAttribute('aria-hidden', this.ui.aboutOpen ? 'false' : 'true');
        }

        if (this.dockLogoBtn) {
            this.dockLogoBtn.classList.toggle('active', this.ui.aboutOpen);
        }

        if (this.ui.aboutOpen) {
            this.positionAboutPopover();
        }
    }

    toggleAboutPopover(forceOpen = null) {
        const next = forceOpen === null ? !this.ui.aboutOpen : !!forceOpen;
        this.setAboutOpen(next);
    }

    setFooterInfoOpen(open) {
        this.ui.footerInfoOpen = !!open;

        if (this.footerInfoPanel) {
            this.footerInfoPanel.classList.toggle('open', this.ui.footerInfoOpen);
            this.footerInfoPanel.setAttribute('aria-hidden', this.ui.footerInfoOpen ? 'false' : 'true');
        }

        if (this.imageInfo) {
            this.imageInfo.classList.toggle('active', this.ui.footerInfoOpen);
            this.imageInfo.setAttribute('aria-expanded', this.ui.footerInfoOpen ? 'true' : 'false');
        }

        if (this.ui.footerInfoOpen && this.status && typeof this.status.refreshFooterDetails === 'function') {
            this.status.refreshFooterDetails();
        }
    }

    toggleFooterInfoPanel(forceOpen = null) {
        const next = forceOpen === null ? !this.ui.footerInfoOpen : !!forceOpen;
        this.setFooterInfoOpen(next);
    }

    positionAboutPopover() {
        if (!this.aboutPopover || !this.dropZone || !this.toolDock) return;

        const containerRect = this.dropZone.getBoundingClientRect();
        const dockRect = this.toolDock.getBoundingClientRect();
        const panelWidth = this.aboutPopover.offsetWidth || 320;
        const panelHeight = this.aboutPopover.offsetHeight || 164;
        const gap = 10;

        let left = (dockRect.right - containerRect.left) + gap;
        let top = dockRect.top - containerRect.top;

        const minLeft = 8;
        const maxLeft = Math.max(8, containerRect.width - panelWidth - 8);
        const minTop = 8;
        const maxTop = Math.max(8, containerRect.height - panelHeight - 8);

        if (left > maxLeft) {
            left = (dockRect.left - containerRect.left) - panelWidth - gap;
        }

        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left));
        const clampedTop = Math.max(minTop, Math.min(maxTop, top));

        this.aboutPopover.style.left = `${Math.round(clampedLeft)}px`;
        this.aboutPopover.style.top = `${Math.round(clampedTop)}px`;
        this.aboutPopover.style.right = 'auto';
    }

    setHistogramOpen(open) {
        this.ui.histogramOpen = !!open;

        if (this.histogramOverlay) {
            this.histogramOverlay.classList.toggle('open', this.ui.histogramOpen);
            this.histogramOverlay.setAttribute('aria-hidden', this.ui.histogramOpen ? 'false' : 'true');
        }

        if (this.histogramToggleBtn) {
            this.histogramToggleBtn.classList.toggle('active', this.ui.histogramOpen);
        }

        if (!this.ui.histogramOpen) {
            this.ui.histogramPinned = false;
        }
        this.updateHistogramPinUI();

        if (this.ui.histogramOpen) {
            this.clampHistogramPosition();
            this.refreshHistogramOverlay();
        }
    }

    toggleHistogramOverlay(forceOpen = null) {
        const next = forceOpen === null ? !this.ui.histogramOpen : !!forceOpen;
        this.setHistogramOpen(next);
    }

    toggleHistogramPin() {
        if (!this.ui.histogramOpen) {
            this.setHistogramOpen(true);
        }
        this.ui.histogramPinned = !this.ui.histogramPinned;
        this.updateHistogramPinUI();
    }

    updateHistogramPinUI() {
        if (!this.histogramPinBtn) return;
        this.histogramPinBtn.classList.toggle('active', this.ui.histogramPinned);
        this.histogramPinBtn.title = this.ui.histogramPinned ? 'Unpin histogram' : 'Pin histogram';
    }

    refreshHistogramOverlay() {
        if (!this.histogram) return;
        requestAnimationFrame(() => {
            this.histogram.setupCanvas();
            this.histogram.render();
            this.histogram.updateHandles();
            this.histogram.updateLabels();
        });
    }

    closeTransientOverlays() {
        let closed = false;

        if (this.ui.aboutOpen) {
            this.setAboutOpen(false);
            closed = true;
        }

        if (this.ui.histogramOpen && !this.ui.histogramPinned) {
            this.setHistogramOpen(false);
            closed = true;
        }

        if (this.ui.threeDPanelOpen) {
            this.set3DPanelOpen(false);
            closed = true;
        }

        if (this.ui.footerInfoOpen) {
            this.setFooterInfoOpen(false);
            closed = true;
        }

        return closed;
    }

    update3DStatusChip() {
        if (!this.resolutionChipText) return;

        let label = '--';
        if (this.resolution3DSelect) {
            const selected = this.resolution3DSelect.options[this.resolution3DSelect.selectedIndex];
            if (selected) {
                label = selected.textContent.split('(')[0].trim();
            }
        }

        const renderer3D = this.ctViewer && this.ctViewer.renderer3D ? this.ctViewer.renderer3D : null;
        const loadedVolume = renderer3D && renderer3D.volumeData ? renderer3D.volumeData : null;
        const dims = loadedVolume && loadedVolume.dimensions
            ? loadedVolume.dimensions
            : (this.volumeState && this.volumeState.dimensions);
        const sourceDownsampled = !!(this.volumeState && this.volumeState.isSourceDownsampled);

        const dimsText = dims ? `${dims[0]}x${dims[1]}x${dims[2]}` : '--';
        const downsampleSuffix = sourceDownsampled ? ' (downsampled source)' : '';
        this.resolutionChipText.textContent = `Resolution: ${label} - ${dimsText}${downsampleSuffix}`;

        const isLowOrMid = !!(loadedVolume && (loadedVolume.isLowRes || loadedVolume.isEnhanced));
        const showWarning = isLowOrMid || sourceDownsampled;
        if (this.viewport3DChip) {
            this.viewport3DChip.classList.toggle('alert', showWarning);
            this.viewport3DChip.title = sourceDownsampled
                ? '3D rendering controls (source auto-downsampled)'
                : '3D rendering controls';
        }

        if (this.status && typeof this.status.refreshFooterDetails === 'function') {
            this.status.refreshFooterDetails();
        }
    }

    async handleFiles(files) {
        try {
            let fileArray = Array.from(files);
            fileArray = this.tryMergeWithPendingRawSelection(fileArray);
            fileArray = await this.tryResolveSingleRawSelection(fileArray);

            const hasRaw = fileArray.some(file => this.fileParser.getFileExtension(file.name).toLowerCase() === 'raw');
            const hasJson = fileArray.some(file => this.fileParser.getFileExtension(file.name).toLowerCase() === 'json');
            const hasVolumeinfo = fileArray.some(file => {
                const name = file.name.toLowerCase();
                return name.endsWith('.raw.volumeinfo') || this.fileParser.getFileExtension(name) === 'volumeinfo';
            });
            const hasDat = fileArray.some(file => this.fileParser.getFileExtension(file.name).toLowerCase() === 'dat');

            if (fileArray.length === 1 && hasRaw && !hasJson && !hasVolumeinfo && !hasDat) {
                this.rememberPendingRawSelection(fileArray[0]);
                return;
            }

            // Group files by type (pairs .raw with .json, etc.)
            const fileGroups = await this.fileParser.groupFilesAsync(fileArray);

            if (fileGroups.length === 0) {
                if (hasRaw && !hasJson && !hasVolumeinfo && !hasDat) {
                    alert('RAW file selected without metadata. Please select the matching .json, .raw.volumeinfo/.volumeinfo, or .dat file at the same time.');
                } else if (hasRaw) {
                    alert('RAW file selected without matching metadata. Ensure the .json, .raw.volumeinfo/.volumeinfo, or .dat has the same base name and select both files together.');
                } else if (this.hasPendingRawSelection() && this.hasAnyRawMetadata(fileArray)) {
                    alert('Selected metadata could not be paired with the remembered RAW file. Please select RAW and metadata together once.');
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
                await this.loaders.dicom.load(selected);
                this.clearPendingRawSelection();
                return;
            }

            const niftiGroup = fileGroups.find(g => g.type === 'nifti');
            if (niftiGroup) {
                await this.loaders.nifti.load(niftiGroup);
                this.clearPendingRawSelection();
                return;
            }

            const tiffGroup = fileGroups.find(g => g.type === 'tiff');
            if (tiffGroup) {
                await this.loaders.tiff.load(tiffGroup);
                this.clearPendingRawSelection();
                return;
            }

            // Process first remaining group (for now, handle one dataset at a time)
            const firstGroup = fileGroups[0];

            if (firstGroup.type === '3d-raw') {
                await this.loaders.raw.load(firstGroup);
                this.clearPendingRawSelection();
            } else if (firstGroup.type === '2d-image') {
                await this.load2DImage(firstGroup);
                this.clearPendingRawSelection();
            }
        } catch (error) {
            console.error('Error loading files:', error);
            alert(`Error loading files: ${error.message}`);
        }
    }

    async tryResolveSingleRawSelection(fileArray) {
        if (!Array.isArray(fileArray) || fileArray.length !== 1) {
            return fileArray;
        }

        const rawFile = fileArray[0];
        const ext = this.fileParser.getFileExtension(rawFile.name).toLowerCase();
        if (ext !== 'raw') {
            return fileArray;
        }

        const pickedMetadata = await this.promptForRawMetadataFile(rawFile);
        if (pickedMetadata) {
            this.clearPendingRawSelection();
            return [rawFile, pickedMetadata];
        }

        this.rememberPendingRawSelection(rawFile);
        return fileArray;
    }

    async promptForRawMetadataFile(rawFile = null) {
        const rawBase = this.getRawBaseName(rawFile && rawFile.name ? rawFile.name : '').toLowerCase();

        const ensureMatching = (file) => {
            if (!file || !rawBase) return file;
            const metadataBase = this.getRawMetadataBaseName(file.name);
            if (!metadataBase || metadataBase !== rawBase) {
                console.warn(
                    `Selected metadata "${file.name}" base does not match RAW "${rawFile.name}". ` +
                    'Proceeding because user explicitly selected this metadata file.'
                );
            }
            return file;
        };

        if (typeof window.showOpenFilePicker === 'function') {
            try {
                const pickerOptions = {
                    multiple: false,
                    excludeAcceptAllOption: false,
                    id: 'raw-metadata-picker',
                    types: [{
                        description: 'RAW metadata',
                        accept: {
                            'application/json': ['.json'],
                            'text/plain': ['.dat', '.volumeinfo', '.raw.volumeinfo']
                        }
                    }]
                };

                const rawHandle = rawFile ? this.getFileHandle(rawFile) : null;
                if (rawHandle) {
                    pickerOptions.startIn = rawHandle;
                }

                const handles = await window.showOpenFilePicker(pickerOptions);
                if (!handles || handles.length === 0) return null;
                const picked = await handles[0].getFile();
                return ensureMatching(picked);
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    return null;
                }
                console.warn('Metadata file picker failed, falling back to input element:', error);
            }
        }

        return new Promise((resolve) => {
            const picker = document.createElement('input');
            picker.type = 'file';
            picker.accept = '.json,.dat,.volumeinfo,.raw.volumeinfo';
            picker.style.display = 'none';

            const cleanup = () => {
                picker.remove();
            };

            picker.addEventListener('change', () => {
                const file = picker.files && picker.files.length > 0 ? picker.files[0] : null;
                cleanup();
                resolve(ensureMatching(file));
            }, { once: true });

            document.body.appendChild(picker);
            picker.click();
        });
    }

    getRawBaseName(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return '';
        }
        return fileName.replace(/\.raw$/i, '');
    }

    getRawMetadataBaseName(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return '';
        }

        return fileName
            .toLowerCase()
            .replace(/\.raw\.volumeinfo$/i, '')
            .replace(/\.volumeinfo$/i, '')
            .replace(/\.raw\.dat$/i, '')
            .replace(/\.dat$/i, '')
            .replace(/\.raw\.json$/i, '')
            .replace(/\.json$/i, '');
    }

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
    }

    createVolumeState() {
        return {
            name: '',
            dimensions: null,
            dataType: null,
            isStreaming: false,
            hasFullData: false,
            lowResVolume: null,
            isSourceDownsampled: false,
            sourceBytes: null,
            loadedBytes: null
        };
    }

    resetVolumeState() {
        this.volumeState = this.createVolumeState();
    }

    updateVolumeState(patch) {
        this.volumeState = { ...this.volumeState, ...patch };
        this.update3DStatusChip();
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
            if (!dims) {
                return { enabled: false, reason: 'Not available', reasonType: 'unavailable' };
            }
            if (!gl || !dataType) {
                return { enabled: true };
            }
            const memCheck = WebGLUtils.checkGPUMemory(gl, dims, dataType);
            const memMB = memCheck && memCheck.memoryInfo
                ? parseFloat(memCheck.memoryInfo.gpuMegabytes)
                : 0;
            if (!memCheck.canLoad) {
                return {
                    enabled: false,
                    reason: memCheck.recommendation || 'Exceeds GPU limits',
                    reasonType: 'memory'
                };
            }
            if (memMB && memMB > MAX_3D_MB) {
                return {
                    enabled: false,
                    reason: `~${memMB.toFixed(0)}MB exceeds ${MAX_3D_MB}MB limit`,
                    reasonType: 'memory'
                };
            }
            return { enabled: true, warning: memCheck.recommendation };
        };

        const formatDims = (dims) => dims ? `${dims[0]}x${dims[1]}x${dims[2]}` : '';
        const applyOption = (value, label, state) => {
            const option = select.querySelector(`option[value="${value}"]`);
            if (!option) return;
            let text = label;
            if (!state.enabled && state.reasonType === 'memory') {
                if (value === 'full') {
                    text = 'Full (Memory limited)';
                } else if (value === 'mid') {
                    text = 'Mid (Memory limited)';
                }
            }
            option.textContent = text;
            option.disabled = !state.enabled;
            option.title = state.reason || '';
        };

        const lowState = canUseDims(lowDims);
        const midState = midAvailable
            ? canUseDims(midDims)
            : { enabled: false, reason: 'Not available', reasonType: 'unavailable' };
        const fullEval = canUseDims(fullDims || baseDims);
        const fullState = fullAvailable
            ? fullEval
            : { ...fullEval, enabled: false, reason: 'Not available', reasonType: 'unavailable' };
        if (state.isStreaming) {
            fullState.reasonType = 'memory';
            fullState.reason = 'Memory limited';
        }

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

        this.update3DStatusChip();
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
            this.update3DStatusChip();
            return;
        }

        if (value === 'mid') {
            if (this.cachedMid3DVolume) {
                this.ctViewer.renderer3D.loadVolume(this.cachedMid3DVolume);
                this.update3DStatusChip();
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

            this.update3DStatusChip();
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

        this.update3DStatusChip();
    }

    async load2DImage(fileGroup) {
        try {
            this.reset3DResolutionCache();
            this.resetVolumeState();
            this.status.showLoadingIndicator('Loading image...');

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
                lowResVolume: null,
                sourceBytes: Number.isFinite(file.size) ? file.size : null,
                loadedBytes: (volumeData && volumeData.data && Number.isFinite(volumeData.data.byteLength))
                    ? volumeData.data.byteLength
                    : null
            });
            this.update3DResolutionOptions('full');

            // Initialize histogram with volume data
            if (this.histogram) {
                this.histogram.setVolume(volumeData);
            }

            // Update UI
            this.status.updateVolumeUI({
                name: file.name,
                dimensions: info.dimensions,
                label: info.dataType
            });

            this.status.hideLoadingIndicator();
        } catch (error) {
            this.status.hideLoadingIndicator();
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

                // Check if grayscale (R~G~B for all pixels, sample first 100)
                let isGrayscale = true;
                for (let i = 0; i < Math.min(pixels.length, 400); i += 4) {
                    if (Math.abs(pixels[i] - pixels[i + 1]) > 5 || Math.abs(pixels[i + 1] - pixels[i + 2]) > 5) {
                        isGrayscale = false;
                        break;
                    }
                }

                let arrayBuffer;
                let metadata;

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
                        data[j] = pixels[i];
                        data[j + sliceSize] = pixels[i + 1];
                        data[j + sliceSize * 2] = pixels[i + 2];
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

        if (this.sliceControls) {
            this.sliceControls.classList.add('visible');
        }

        // Enable ROI and crosshair buttons
        const roiBtn = document.getElementById('roiBtn');
        if (roiBtn) {
            roiBtn.disabled = false;
            roiBtn.classList.remove('active');
        }

        const crosshairBtn = document.getElementById('crosshairBtn');
        if (crosshairBtn) {
            crosshairBtn.disabled = false;
        }

        // Set crosshair state based on CTViewer
        if (this.ctViewer && this.ctViewer.isCrosshairEnabled()) {
            this.ui.crosshairEnabled = true;
            if (crosshairBtn) crosshairBtn.classList.add('active');
            if (this.pixelInfoGroup) {
                this.pixelInfoGroup.style.display = 'inline-flex';
            }
        } else {
            this.ui.crosshairEnabled = false;
            if (crosshairBtn) crosshairBtn.classList.remove('active');
            if (this.pixelInfoGroup) {
                this.pixelInfoGroup.style.display = 'none';
            }
        }

        if (this.status && typeof this.status.refreshSliceIndicators === 'function') {
            this.status.refreshSliceIndicators();
        }
        this.update3DStatusChip();
    }
}

// Initialize the viewer
const viewer = new ImageViewer();
