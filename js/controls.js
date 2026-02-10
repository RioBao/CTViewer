class ViewerControls {
    constructor(viewer) {
        this.viewer = viewer;
    }

    bind() {
        const viewer = this.viewer;

        document.getElementById('openBtn').addEventListener('click', () => viewer.fileInput.click());
        document.getElementById('zoomInBtn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn').addEventListener('click', () => this.zoomOut());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetView());
        document.getElementById('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('roiBtn').addEventListener('click', () => this.toggleRoiMode());
        document.getElementById('crosshairBtn').addEventListener('click', () => this.toggleCrosshairs());

        viewer.fileInput.addEventListener('change', (e) => viewer.handleFiles(e.target.files));

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
                    viewer.fileInput.click();
                }
                break;
            case 'ArrowLeft':
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, -1);
                }
                break;
            case 'ArrowRight':
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, 1);
                }
                break;
            case 'ArrowUp':
                if (viewer.ctViewer && viewer.ctViewer.state.activeView) {
                    e.preventDefault();
                    viewer.ctViewer.navigateSlice(viewer.ctViewer.state.activeView, -10);
                }
                break;
            case 'ArrowDown':
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
            case 'Escape':
                if (viewer.ctViewer && viewer.ctViewer.isRoiMode()) {
                    this.toggleRoiMode();
                }
                break;
        }
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
        e.preventDefault();
        viewer.dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        viewer.handleFiles(files);
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    toggleRoiMode() {
        const viewer = this.viewer;
        if (!viewer.ctViewer) return;

        const roiBtn = document.getElementById('roiBtn');
        const isActive = viewer.ctViewer.toggleRoiMode();

        if (isActive) {
            roiBtn.classList.add('active');
            roiBtn.title = 'ROI mode active - draw rectangle to set range';
        } else {
            roiBtn.classList.remove('active');
            roiBtn.title = 'Set range from region';
        }
    }

    toggleCrosshairs() {
        const viewer = this.viewer;
        if (!viewer.ctViewer) return;

        const crosshairBtn = document.getElementById('crosshairBtn');
        const isEnabled = viewer.ctViewer.toggleCrosshairs();

        if (isEnabled) {
            crosshairBtn.classList.add('active');
            crosshairBtn.title = 'Crosshairs visible - click to hide';
            viewer.pixelInfoGroup.style.display = 'block';
            viewer.ctViewer.notifyCrosshairChange();
        } else {
            crosshairBtn.classList.remove('active');
            crosshairBtn.title = 'Crosshairs hidden - click to show';
            viewer.pixelInfoGroup.style.display = 'none';
        }
    }
}

window.ViewerControls = ViewerControls;
