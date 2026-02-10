(() => {
    const formats = {
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
        tiff: ['tif', 'tiff'],
        raw: ['raw'],
        rawMetadata: ['json', 'volumeinfo', 'dat'],
        dicom: ['dcm'],
        nifti: ['nii', 'nii.gz']
    };

    const dot = (ext) => ext.startsWith('.') ? ext : `.${ext}`;
    const accept = [
        'image/*',
        ...formats.raw.map(dot),
        ...formats.rawMetadata.map(dot),
        ...formats.tiff.map(dot),
        ...formats.dicom.map(dot),
        ...formats.nifti.map(dot)
    ].join(',');

    window.ViewerConfig = {
        formats,
        limits: {
            streamingThresholdBytes: 2 * 1024 * 1024 * 1024,
            progressiveThresholdBytes: 50 * 1024 * 1024
        },
        progressive: {
            numBlocks: 5,
            downsampleScale: 4
        },
        accept
    };
})();
