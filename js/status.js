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
            this.setSliceIndicator(axis, sliceIndex, totalSlices);
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
            const { value } = e.detail;
            if (viewer.pixelInfo) {
                viewer.pixelInfo.textContent = `V=${this.formatVoxelValue(value)}`;
            }
        });
    }

    formatVoxelValue(value) {
        const viewer = this.viewer;
        if (!Number.isFinite(value)) return '--';

        const dataType = viewer && viewer.ctViewer && viewer.ctViewer.volumeData
            ? String(viewer.ctViewer.volumeData.dataType || '').toLowerCase()
            : '';
        const isIntegerType = dataType === 'uint8' || dataType === 'uint16' || dataType === 'int16' || dataType === 'int32';

        if (isIntegerType) {
            return `${Math.round(value)}`;
        }

        // Float-like data: keep precision so values don't collapse to 0/1/2.
        return `${Number(value).toFixed(2)}`;
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
            this.setSliceIndicator('xy', Math.floor(nz / 2), nz);
        }
        if (viewer.sliceIndicatorXZ) {
            this.setSliceIndicator('xz', Math.floor(ny / 2), ny);
        }
        if (viewer.sliceIndicatorYZ) {
            this.setSliceIndicator('yz', Math.floor(nx / 2), nx);
        }
    }

    setSliceIndicator(axis, sliceIndex, totalSlices) {
        const viewer = this.viewer;
        const indicator = axis === 'xy' ? viewer.sliceIndicatorXY :
                        axis === 'xz' ? viewer.sliceIndicatorXZ :
                        viewer.sliceIndicatorYZ;

        if (!indicator || !Number.isFinite(totalSlices) || totalSlices <= 0) return;
        const axisLabel = axis.toUpperCase();
        const comma = viewer.ui && viewer.ui.crosshairEnabled ? ',' : '';
        indicator.textContent = `${axisLabel}: ${sliceIndex + 1}/${totalSlices}${comma}`;
    }

    refreshSliceIndicators() {
        const viewer = this.viewer;
        if (!viewer.ctViewer || !viewer.ctViewer.volumeData) return;

        const [nx, ny, nz] = viewer.ctViewer.volumeData.dimensions;
        const slices = viewer.ctViewer.state.slices;
        this.setSliceIndicator('xy', slices.xy, nz);
        this.setSliceIndicator('xz', slices.xz, ny);
        this.setSliceIndicator('yz', slices.yz, nx);
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
                const percent = Number.isFinite(progress.progress)
                    ? Math.max(0, Math.min(100, Math.round(progress.progress)))
                    : null;
                progressEl.textContent = percent === null
                    ? 'Streaming mode: Creating preview...'
                    : `Streaming mode: Creating preview... ${percent}%`;
            } else if (progress.stage === 'parsing' || progress.stage === 'processing') {
                progressEl.textContent = 'Processing volume data...';
            } else if (progress.stage === 'complete') {
                progressEl.textContent = 'Complete!';
            }
        }
    }
}

window.ViewerStatus = ViewerStatus;
