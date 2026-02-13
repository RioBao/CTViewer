class NiftiVolumeLoader {
    constructor(viewer) {
        this.viewer = viewer;
    }

    async load(fileGroup) {
        const viewer = this.viewer;
        try {
            viewer.reset3DResolutionCache();
            viewer.resetVolumeState();
            viewer.status.showLoadingIndicator('Loading NIfTI...');

            const volumeData = await viewer.fileParser.loadNifti(fileGroup.file);
            const PROGRESSIVE_THRESHOLD = (typeof WebGLUtils !== 'undefined' &&
                typeof WebGLUtils.getVolumeProgressiveThresholdBytes === 'function')
                ? WebGLUtils.getVolumeProgressiveThresholdBytes()
                : 50 * 1024 * 1024;
            const sourceBytes = Number.isFinite(fileGroup.file && fileGroup.file.size)
                ? fileGroup.file.size
                : null;

            const volumeBytes = volumeData && volumeData.data ? volumeData.data.byteLength : 0;
            const is3D = volumeData && volumeData.dimensions && volumeData.dimensions[2] > 1;

            if (is3D && volumeBytes > PROGRESSIVE_THRESHOLD) {
                await this.loadProgressive(fileGroup, volumeData, sourceBytes);
            } else {
                await this.loadDirect(fileGroup, volumeData, sourceBytes);
            }
        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }

    async loadDirect(fileGroup, volumeData, sourceBytes = null) {
        const viewer = this.viewer;
        viewer.switchToCTMode();

        const info = viewer.ctViewer.loadVolume(volumeData);
        viewer.updateVolumeState({
            name: fileGroup.name || 'NIfTI',
            dimensions: info.dimensions,
            dataType: info.dataType,
            isStreaming: false,
            hasFullData: true,
            lowResVolume: null,
            sourceBytes,
            loadedBytes: (volumeData && volumeData.data && Number.isFinite(volumeData.data.byteLength))
                ? volumeData.data.byteLength
                : null
        });
        viewer.update3DResolutionOptions('full');

        if (viewer.histogram) {
            viewer.histogram.setVolume(volumeData);
        }

        viewer.status.updateVolumeUI({
            name: fileGroup.name || 'NIfTI',
            dimensions: info.dimensions,
            label: `NIfTI ${info.dataType}`
        });

        viewer.status.hideLoadingIndicator();
    }

    async loadProgressive(fileGroup, volumeData, sourceBytes = null) {
        const viewer = this.viewer;
        viewer.switchToCTMode();

        let progressiveData = null;
        const name = fileGroup.name || 'NIfTI';
        const metadata = {
            dimensions: volumeData.dimensions,
            dataType: volumeData.dataType,
            spacing: volumeData.spacing
        };

        const callbacks = {
            onProgress: (progress) => {
                viewer.status.updateLoadingProgress(progress);
            },
            onLowResReady: (lowResVolume, progData) => {
                progressiveData = progData;
                viewer.ctViewer.progressiveVolume = progData;
                viewer.ctViewer.volumeData = progData;

                viewer.updateVolumeState({
                    name,
                    dimensions: progData.dimensions,
                    dataType: progData.dataType,
                    isStreaming: !!progData.isStreaming,
                    hasFullData: false,
                    lowResVolume,
                    sourceBytes,
                    loadedBytes: (lowResVolume && lowResVolume.data && Number.isFinite(lowResVolume.data.byteLength))
                        ? lowResVolume.data.byteLength
                        : null
                });
                viewer.status.updateVolumeUI({
                    name,
                    dimensions: progData.dimensions,
                    label: 'Progressive',
                    loading: true
                });

                if (viewer.histogram) {
                    viewer.histogram.setVolume(progData);
                }

                viewer.update3DResolutionOptions('low');
                viewer.status.hideLoadingIndicator();
                viewer.ctViewer.handleLowResReady(lowResVolume);
            },
            onBlockReady: (blockIndex, zStart, zEnd) => {
                viewer.ctViewer.handleBlockReady(blockIndex, zStart, zEnd);
            },
            onAllBlocksReady: () => {
                viewer.updateVolumeState({
                    name,
                    dimensions: progressiveData.dimensions,
                    dataType: progressiveData.dataType,
                    isStreaming: false,
                    hasFullData: true,
                    sourceBytes,
                    loadedBytes: (progressiveData && progressiveData.data && Number.isFinite(progressiveData.data.byteLength))
                        ? progressiveData.data.byteLength
                        : viewer.volumeState.loadedBytes
                });
                viewer.status.updateVolumeUI({
                    name,
                    dimensions: progressiveData.dimensions,
                    label: `NIfTI ${progressiveData.dataType}`
                });

                viewer.ctViewer.handleAllBlocksReady();
                viewer.update3DResolutionOptions();
            }
        };

        const loader = new ProgressiveVolumeLoader();
        await loader.loadProgressive(volumeData.data.buffer, metadata, callbacks);
    }
}

window.NiftiVolumeLoader = NiftiVolumeLoader;
