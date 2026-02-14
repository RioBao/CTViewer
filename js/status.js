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
        const statusSummary = this.getVolumeStatusSummary(loading);
        const suffix = statusSummary ? ` | ${statusSummary}` : '';

        if (viewer.fileName) {
            viewer.fileName.textContent = displayName || 'No file loaded';
        }
        if (viewer.imageInfo) {
            viewer.imageInfo.textContent = `${nx}x${ny}x${nz} | ${label}${suffix}`;
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

        this.refreshFooterDetails();
    }

    getVolumeStatusSummary(loading = false) {
        const viewer = this.viewer;
        const state = viewer && viewer.volumeState ? viewer.volumeState : null;
        if (!state) return '';

        if (state.isSourceDownsampled) {
            return 'Source reduced for stability';
        }

        if (state.isStreaming) {
            return state.hasFullData ? 'Streaming mode' : 'Low-res preview';
        }

        if (!state.hasFullData) {
            if (loading || state.lowResVolume) {
                return 'Low-res preview';
            }
            return 'Loading';
        }

        return 'Full quality';
    }

    refreshFooterDetails() {
        const viewer = this.viewer;
        if (!viewer || !viewer.footerInfoGrid) return;

        const rows = this.getFooterDetailRows();
        viewer.footerInfoGrid.replaceChildren();

        for (const row of rows) {
            const labelEl = document.createElement('span');
            labelEl.className = 'footer-info-label';
            labelEl.textContent = row.label;

            const valueEl = document.createElement('span');
            valueEl.className = 'footer-info-value';
            valueEl.textContent = row.value;
            valueEl.title = row.value;

            viewer.footerInfoGrid.appendChild(labelEl);
            viewer.footerInfoGrid.appendChild(valueEl);
        }
    }

    getFooterDetailRows() {
        const viewer = this.viewer;
        const state = viewer && viewer.volumeState ? viewer.volumeState : null;

        if (!state || !state.dimensions) {
            return [{ label: 'Dataset', value: 'No volume loaded' }];
        }

        const renderer3D = viewer.ctViewer && viewer.ctViewer.renderer3D ? viewer.ctViewer.renderer3D : null;
        const active3D = renderer3D && renderer3D.volumeData ? renderer3D.volumeData : null;
        const active3DBytes = active3D && active3D.data && Number.isFinite(active3D.data.byteLength)
            ? active3D.data.byteLength
            : null;

        let active3DProfile = '--';
        if (active3D) {
            if (active3D.isLowRes) {
                active3DProfile = 'Low preview';
            } else if (active3D.isEnhanced) {
                active3DProfile = 'Mid enhanced';
            } else {
                active3DProfile = 'Full';
            }
        }

        const rows = [];
        const pushRow = (label, value) => {
            if (!value || value === '--') return;
            rows.push({ label, value });
        };

        const dims = this.formatDimensions(state.dimensions);
        const dtype = state.dataType || '--';
        const summary = (dims !== '--' && dtype !== '--') ? `${dims} (${dtype})` : (dims !== '--' ? dims : dtype);
        pushRow('Volume', summary);
        pushRow('Status', this.getVolumeStatusSummary(false));
        const orientationRows = this.getOrientationDetailRows(state, viewer);
        for (const row of orientationRows) {
            pushRow(row.label, row.value);
        }

        const selected3D = this.getSelected3DResolutionLabel();
        const renderSummary = (selected3D !== '--' && active3DProfile !== '--')
            ? `${selected3D} (${active3DProfile})`
            : (selected3D !== '--' ? selected3D : active3DProfile);
        pushRow('3D', renderSummary);

        const disk = this.formatBytes(state.sourceBytes);
        const decoded = this.formatBytes(state.loadedBytes);
        if (disk !== '--' || decoded !== '--') {
            const memSummary = (disk !== '--' && decoded !== '--')
                ? `${disk} disk | ${decoded} decoded`
                : (disk !== '--' ? `${disk} disk` : `${decoded} decoded`);
            pushRow('Storage', memSummary);
        }

        const active3DMem = this.formatBytes(active3DBytes);
        if (active3DMem !== '--') {
            const activeDims = this.formatDimensions(active3D && active3D.dimensions);
            const activeSummary = activeDims !== '--'
                ? `${active3DMem} (${activeDims})`
                : active3DMem;
            pushRow('3D memory', activeSummary);
        }

        if (state.isSourceDownsampled) {
            pushRow('Note', 'Source reduced for stability');
        }

        return rows;
    }

    getOrientationDetailRows(state, viewer) {
        const info = this.resolveOrientationInfo(state, viewer);
        if (!info) return [];

        const perm = Array.isArray(info.permutation) ? info.permutation.slice(0, 3) : [0, 1, 2];
        const signs = Array.isArray(info.signs) ? info.signs.slice(0, 3) : [1, 1, 1];
        const displaySigns = Array.isArray(info.displaySigns) ? info.displaySigns.slice(0, 3) : [1, 1, 1];
        const modality = (typeof info.modality === 'string' && info.modality)
            ? info.modality.toUpperCase()
            : 'Volume';
        const source = (typeof info.source === 'string' && info.source) ? info.source : 'unknown';
        const sourceLabel = source === 'none' ? 'header missing' : source;
        const signLabel = signs.map((v) => (v >= 0 ? '+' : '-')).join(',');
        const displayLabel = displaySigns.map((v) => (v >= 0 ? '+' : '-')).join(',');
        const appliedLabel = info.applied ? 'applied' : 'not needed';
        const permApplied = info.permutationApplied !== false;
        const permNote = permApplied ? '' : ' | perm not applied';

        return [
            { label: 'Orientation', value: `${modality} ${sourceLabel} (${appliedLabel})` },
            { label: 'Axis map', value: `out[x,y,z] <- in[${perm.join(',')}] | flips [${signLabel}]${permNote}` },
            { label: 'Display conv', value: `viewer signs [${displayLabel}]` }
        ];
    }

    resolveOrientationInfo(state, viewer) {
        if (state && state.orientationInfo && typeof state.orientationInfo === 'object') {
            return state.orientationInfo;
        }

        const volumeData = viewer && viewer.ctViewer ? viewer.ctViewer.volumeData : null;
        if (volumeData && volumeData.metadata && volumeData.metadata.niftiOrientation) {
            return volumeData.metadata.niftiOrientation;
        }

        const progressive = viewer && viewer.ctViewer ? viewer.ctViewer.progressiveVolume : null;
        if (progressive && progressive.metadata && progressive.metadata.niftiOrientation) {
            return progressive.metadata.niftiOrientation;
        }

        return null;
    }

    getSelected3DResolutionLabel() {
        const viewer = this.viewer;
        const select = viewer && viewer.resolution3DSelect ? viewer.resolution3DSelect : null;
        if (!select || !select.options || select.selectedIndex < 0) return '--';
        const option = select.options[select.selectedIndex];
        if (!option || !option.textContent) return '--';
        return option.textContent.trim();
    }

    formatDimensions(dims) {
        if (!Array.isArray(dims) || dims.length !== 3) return '--';
        const [nx, ny, nz] = dims;
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return '--';
        return `${nx}x${ny}x${nz}`;
    }

    formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '--';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }
        const precision = value >= 100 ? 0 : (value >= 10 ? 1 : 2);
        return `${value.toFixed(precision)} ${units[unitIndex]}`;
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
            const percent = Number.isFinite(progress && progress.progress)
                ? Math.max(0, Math.min(100, Math.round(progress.progress)))
                : null;

            if (progress.stage === 'metadata') {
                progressEl.textContent = percent === null
                    ? 'Loading metadata...'
                    : `Loading metadata... ${percent}%`;
            } else if (progress.stage === 'loading') {
                progressEl.textContent = percent === null
                    ? 'Loading volume data...'
                    : `Loading volume data... ${percent}%`;
            } else if (progress.stage === 'streaming') {
                progressEl.textContent = percent === null
                    ? 'Streaming mode: Creating preview...'
                    : `Streaming mode: Creating preview... ${percent}%`;
            } else if (progress.stage === 'parsing' || progress.stage === 'processing') {
                progressEl.textContent = percent === null
                    ? 'Processing volume data...'
                    : `Processing volume data... ${percent}%`;
            } else if (progress.stage === 'complete') {
                progressEl.textContent = 'Complete!';
            }
        }
    }
}

window.ViewerStatus = ViewerStatus;
