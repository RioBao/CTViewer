class ViewerStatus {
    constructor(viewer) {
        this.viewer = viewer;
    }

    applyFormatConfig() {
        const viewer = this.viewer;
        if (!viewer.fileInput) return;
        if (typeof ViewerConfig === 'undefined') return;
        const accept = ViewerConfig.accept;
        if (accept) {
            viewer.fileInput.accept = accept;
        }
    }

    bind() {
        const viewer = this.viewer;

        document.addEventListener('slicechange', (e) => {
            const { axis, sliceIndex, totalSlices } = e.detail;
            const indicator = axis === 'xy' ? viewer.sliceIndicatorXY :
                            axis === 'xz' ? viewer.sliceIndicatorXZ :
                            viewer.sliceIndicatorYZ;

            if (indicator) {
                const axisLabel = axis.toUpperCase();
                indicator.textContent = `${axisLabel}: ${sliceIndex + 1}/${totalSlices}`;
            }
        });

        document.addEventListener('zoomchange', (e) => {
            if (viewer.zoomLevel) {
                viewer.zoomLevel.textContent = `${Math.round(e.detail.zoom * 100)}%`;
            }
        });

        document.addEventListener('rangechange', (e) => {
            const { min, max } = e.detail;
            if (viewer.histogram) {
                viewer.histogram.setRange(min, max);
            }
        });

        document.addEventListener('crosshairchange', (e) => {
            const { x, y, z, value } = e.detail;
            if (viewer.pixelInfo) {
                const gray = Number.isFinite(value) ? Math.round(value) : value;
                viewer.pixelInfo.textContent = `X:${x},Y:${y},Z:${z}=${gray}`;
            }
        });
    }

    updateVolumeUI({ name, dimensions, label, loading = false }) {
        const viewer = this.viewer;
        if (!dimensions || dimensions.length !== 3) return;

        const [nx, ny, nz] = dimensions;
        const displayName = loading ? `${name} (loading...)` : name;

        if (viewer.fileName) {
            viewer.fileName.textContent = displayName || 'No file loaded';
        }
        if (viewer.imageInfo) {
            viewer.imageInfo.textContent = `${nx}x${ny}x${nz} | ${label}`;
        }

        if (viewer.sliceIndicatorXY) {
            viewer.sliceIndicatorXY.textContent = `XY: ${Math.floor(nz / 2) + 1}/${nz}`;
        }
        if (viewer.sliceIndicatorXZ) {
            viewer.sliceIndicatorXZ.textContent = `XZ: ${Math.floor(ny / 2) + 1}/${ny}`;
        }
        if (viewer.sliceIndicatorYZ) {
            viewer.sliceIndicatorYZ.textContent = `YZ: ${Math.floor(nx / 2) + 1}/${nx}`;
        }
    }

    showLoadingIndicator(message) {
        const viewer = this.viewer;
        let overlay = document.querySelector('.loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-spinner"></div>
                <div class="loading-text">${message}</div>
                <div class="loading-progress"></div>
            `;
            viewer.dropZone.appendChild(overlay);
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

window.ViewerStatus = ViewerStatus;
