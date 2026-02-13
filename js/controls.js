class ViewerControls {
    constructor(viewer) {
        this.viewer = viewer;
    }

    bind() {
        const viewer = this.viewer;

        const openBtn = document.getElementById('openBtn');
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetBtn = document.getElementById('resetBtn');
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const roiBtn = document.getElementById('roiBtn');
        const crosshairBtn = document.getElementById('crosshairBtn');

        if (openBtn) openBtn.addEventListener('click', () => viewer.fileInput.click());
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetView());
        if (fullscreenBtn) fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        if (roiBtn) roiBtn.addEventListener('click', () => this.toggleRoiMode());
        if (crosshairBtn) crosshairBtn.addEventListener('click', () => this.toggleCrosshairs());

        viewer.fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                viewer.handleFiles(e.target.files);
            }
        });

        viewer.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        viewer.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        viewer.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        document.addEventListener('keydown', (e) => this.handleKeyDown(e));

        const quality3DSelect = document.getElementById('quality3DSelect');
        if (quality3DSelect) {
            if (viewer.ctViewer && viewer.ctViewer.renderer3D) {
                viewer.ctViewer.renderer3D.setQuality(quality3DSelect.value);
            }
            quality3DSelect.addEventListener('change', (e) => {
                if (viewer.ctViewer && viewer.ctViewer.renderer3D) {
                    viewer.ctViewer.renderer3D.setQuality(e.target.value);
                    viewer.update3DStatusChip();
                }
            });
        }

        const gamma3DSlider = document.getElementById('gamma3DSlider');
        const gamma3DValue = document.getElementById('gamma3DValue');
        if (gamma3DSlider) {
            gamma3DSlider.addEventListener('input', (e) => {
                const gamma = parseFloat(e.target.value);
                if (gamma3DValue) {
                    gamma3DValue.textContent = gamma.toFixed(1);
                }
                if (viewer.ctViewer && viewer.ctViewer.renderer3D) {
                    viewer.ctViewer.renderer3D.setGamma(gamma);
                }
            });
        }

        if (viewer.resolution3DSelect) {
            viewer.resolution3DSelect.addEventListener('change', async (e) => {
                const value = e.target.value;
                await viewer.set3DResolution(value);
            });
        }
    }

    handleKeyDown(e) {
        const viewer = this.viewer;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

        switch (key) {
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
            case 'h':
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.toggleHistogram();
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
                    viewer.fileInput.click();
                }
                break;
            case 'ArrowLeft':
                if (this.handle3DRotation('left')) {
                    e.preventDefault();
                    break;
                }
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, -1);
                }
                break;
            case 'ArrowRight':
                if (this.handle3DRotation('right')) {
                    e.preventDefault();
                    break;
                }
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, 1);
                }
                break;
            case 'ArrowUp':
                if (this.handle3DRotation('up')) {
                    e.preventDefault();
                    break;
                }
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, -10);
                }
                break;
            case 'ArrowDown':
                if (this.handle3DRotation('down')) {
                    e.preventDefault();
                    break;
                }
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, 10);
                }
                break;
            case 'Home':
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.navigateToSliceEdge(viewer.ctViewer.state.activeView, 'first');
                }
                break;
            case 'End':
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    this.navigateToSliceEdge(viewer.ctViewer.state.activeView, 'last');
                }
                break;
            case 'Escape': {
                let handled = false;
                if (viewer.closeTransientOverlays && viewer.closeTransientOverlays()) {
                    handled = true;
                }
                if (viewer.ctViewer && viewer.ctViewer.isRoiMode()) {
                    this.toggleRoiMode();
                    handled = true;
                }
                if (handled) {
                    e.preventDefault();
                }
                break;
            }
        }
    }

    handle3DRotation(direction) {
        const viewer = this.viewer;
        if (!viewer.ctViewer || !viewer.ctViewer.renderer3D) return false;
        const active3D = viewer.ctViewer.state.activeView === '3d' ||
            viewer.ctViewer.maximizedView === '3d';
        if (!active3D) return false;

        const step = 5;
        const camera = viewer.ctViewer.renderer3D.getCamera();
        viewer.ctViewer.renderer3D.pan = { x: 0, y: 0 };
        if (direction === 'left') camera.roll -= step;
        if (direction === 'right') camera.roll += step;
        if (direction === 'up') camera.elevation -= step;
        if (direction === 'down') camera.elevation += step;

        viewer.ctViewer.renderer3D.setCamera(camera);
        return true;
    }

    navigateToSliceEdge(axis, edge) {
        const viewer = this.viewer;
        if (!viewer.ctViewer || !viewer.ctViewer.volumeData) return;
        const [nx, ny, nz] = viewer.ctViewer.volumeData.dimensions;
        const maxSlice = axis === 'xy' ? nz - 1 : axis === 'xz' ? ny - 1 : nx - 1;
        const target = edge === 'first' ? 0 : maxSlice;
        const current = viewer.ctViewer.state.slices[axis];
        viewer.ctViewer.navigateSlice(axis, target - current);
    }

    zoomIn() {
        const viewer = this.viewer;
        if (viewer.ctViewer) {
            const state = viewer.ctViewer.getState();
            viewer.ctViewer.updateZoom(state.zoom + 0.2);
        }
    }

    zoomOut() {
        const viewer = this.viewer;
        if (viewer.ctViewer) {
            const state = viewer.ctViewer.getState();
            viewer.ctViewer.updateZoom(state.zoom - 0.2);
        }
    }

    resetView() {
        const viewer = this.viewer;
        if (viewer.ctViewer) {
            viewer.ctViewer.resetView();
            viewer.ctViewer.resetDataRange();
        }
        if (viewer.histogram) {
            viewer.histogram.reset();
        }
    }

    handleDragOver(e) {
        const viewer = this.viewer;
        if (!this.isFileDrag(e)) return;
        e.preventDefault();
        viewer.dropZone.classList.add('drag-over');
    }

    handleDragLeave(e) {
        const viewer = this.viewer;
        if (!viewer.dropZone.contains(e.relatedTarget)) {
            viewer.dropZone.classList.remove('drag-over');
        }
    }

    handleDrop(e) {
        const viewer = this.viewer;
        if (!this.isFileDrag(e)) return;
        e.preventDefault();
        viewer.dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            viewer.handleFiles(files);
        }
    }

    isFileDrag(e) {
        if (!e || !e.dataTransfer || !e.dataTransfer.types) return false;
        return Array.from(e.dataTransfer.types).includes('Files');
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    toggleHistogram() {
        const viewer = this.viewer;
        if (viewer && typeof viewer.toggleHistogramOverlay === 'function') {
            viewer.toggleHistogramOverlay();
        }
    }

    toggleRoiMode() {
        const viewer = this.viewer;
        if (!viewer.ctViewer) return;

        const roiBtn = document.getElementById('roiBtn');
        if (roiBtn && roiBtn.disabled) return;
        const isActive = viewer.ctViewer.toggleRoiMode();

        if (roiBtn) {
            if (isActive) {
                roiBtn.classList.add('active');
                roiBtn.title = 'ROI mode active - draw rectangle to set range';
            } else {
                roiBtn.classList.remove('active');
                roiBtn.title = 'Set range from region';
            }
        }
    }

    toggleCrosshairs() {
        const viewer = this.viewer;
        if (!viewer.ctViewer) return;

        const crosshairBtn = document.getElementById('crosshairBtn');
        if (crosshairBtn && crosshairBtn.disabled) return;
        const isEnabled = viewer.ctViewer.toggleCrosshairs();
        viewer.ui.crosshairEnabled = isEnabled;

        if (isEnabled) {
            if (crosshairBtn) {
                crosshairBtn.classList.add('active');
                crosshairBtn.title = 'Crosshairs visible - click to hide';
            }
            if (viewer.pixelInfoGroup) {
                viewer.pixelInfoGroup.style.display = 'inline-flex';
            }
            viewer.ctViewer.notifyCrosshairChange();
        } else {
            if (crosshairBtn) {
                crosshairBtn.classList.remove('active');
                crosshairBtn.title = 'Crosshairs hidden - click to show';
            }
            if (viewer.pixelInfoGroup) {
                viewer.pixelInfoGroup.style.display = 'none';
            }
        }

        if (viewer.status && typeof viewer.status.refreshSliceIndicators === 'function') {
            viewer.status.refreshSliceIndicators();
        }
    }
}

window.ViewerControls = ViewerControls;
