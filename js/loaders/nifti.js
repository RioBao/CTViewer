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

            viewer.switchToCTMode();

            const info = viewer.ctViewer.loadVolume(volumeData);
            viewer.updateVolumeState({
                name: fileGroup.name || 'NIfTI',
                dimensions: info.dimensions,
                dataType: info.dataType,
                isStreaming: false,
                hasFullData: true,
                lowResVolume: null
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
        } catch (error) {
            viewer.status.hideLoadingIndicator();
            throw error;
        }
    }
}

window.NiftiVolumeLoader = NiftiVolumeLoader;
