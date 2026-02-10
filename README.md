# Industrial CT Viewer

A modern web-based CT (Computed Tomography) viewer for industrial inspection and non-destructive testing. Supports both standard 2D images and 3D CT volumes with synchronized orthogonal slice views.

## Features

### Standard 2D Viewing
- 📁 Open multiple images at once
- 🖼️ Thumbnail sidebar for quick navigation
- 🔍 Zoom in/out (mouse wheel with Ctrl or buttons)
- ⬅️➡️ Navigate between images
- 🖱️ Drag to pan when zoomed in
- 🎚️ Contrast and brightness controls
- ⌨️ Keyboard shortcuts
- 📱 Drag and drop support
- 🌓 Dark theme interface

### 3D CT Viewing
- 🏭 2x2 grid layout with three orthogonal slice views (Axial XY, Coronal XZ, Sagittal YZ)
- 🔄 Synchronized zoom and pan across all views
- 📊 Mouse wheel slice navigation (per view)
- 🎚️ Contrast and brightness controls
- 📏 Real-time slice position indicators
- 🗜️ Support for uint8, uint16, and float32 data types
- 💾 Efficient slice extraction and rendering

## Supported Formats

### 2D Images
- Standard formats: JPG, PNG, GIF, WebP, BMP
- TIFF (single-page)

### 3D CT Volumes
- **RAW binary files** with separate metadata (.json, .raw.volumeinfo, or .dat)
- **DICOM series** (uncompressed, Explicit/Implicit VR Little Endian)
  - Select multiple DICOM files in the file picker (or drag and drop)
  - If multiple series are present, the largest series is auto-selected and a warning is logged
- **NIfTI** (.nii, .nii.gz) - first volume only for 4D datasets
- Multi-page TIFF (planned)

## Usage

### Getting Started
1. Open `index.html` in a modern web browser
2. Click "Open" to select files (including DICOM series) or drag and drop files onto the viewer

### 2D Images
- Select one or more standard image files
- Use navigation buttons or arrow keys to switch between images
- Zoom with mouse wheel (Ctrl + scroll) or zoom buttons
- Click and drag to pan when zoomed in
- **Contrast/Brightness controls**: Adjust image appearance with sliders
  - Contrast: 0.5 to 2.0 (1.0 = normal)
  - Brightness: -100 to +100 (0 = normal)
  - Click "Reset" to restore defaults

### 3D CT Volumes
1. Select **both** the .raw file and its corresponding metadata file (.json, .raw.volumeinfo, or .dat)
   - Example: `volume.raw` + `volume.json`
2. The viewer automatically switches to CT mode with 2x2 grid layout
3. Interact with the views:
   - **Mouse wheel**: Navigate through slices in the active view
   - **Ctrl + wheel**: Synchronized zoom across all views
   - **Click and drag**: Synchronized pan across all views
   - **Contrast/Brightness sliders**: Adjust image appearance

### DICOM Series
1. Click "Open" and select multiple files from the DICOM series (or drag and drop the files)
2. If multiple series are detected, the viewer auto-selects the largest series and logs a warning
3. The viewer switches to CT mode automatically

### NIfTI
1. Click "Open" and select a `.nii` or `.nii.gz` file
2. The viewer loads the first volume for 4D files and switches to CT mode
3. RGB24 NIfTI volumes are converted to grayscale for display

## Keyboard Shortcuts

### Standard 2D Mode
- `←` / `→` - Previous/Next image
- `+` / `-` - Zoom in/out
- `0` - Reset zoom
- `F` - Toggle fullscreen

### 3D CT Mode
- Mouse wheel - Navigate slices
- `Ctrl` + wheel - Zoom
- `0` - Reset view

## Architecture

### Core Components

```
D:\Programming\Viewer\
├── index.html              # Main HTML structure
├── style.css               # Styling for both 2D and 3D modes
├── script.js               # Main orchestrator and routing
├── js/
│   ├── VolumeData.js       # 3D volume data container and slice extraction
│   ├── SliceRenderer.js    # Canvas-based slice rendering
│   ├── ImageProcessor.js   # Contrast, brightness, window/level
│   ├── FileParser.js       # File type detection and parsing
│   ├── DicomLoader.js      # DICOM series parsing (uncompressed)
│   ├── NiftiLoader.js      # NIfTI parsing (.nii/.nii.gz)
│   └── CTViewer.js         # CT viewing orchestrator with state management
├── test-data/              # Sample volumes for testing
│   ├── README.md           # Guide for adding custom data
│   ├── simple_test.raw/.json
│   └── checker_test.raw/.json
└── README.md               # This file
```

### Technology Stack
- **Vanilla JavaScript** - No framework dependencies
- **Canvas 2D API** - Hardware-accelerated rendering
- **CSS Grid** - Responsive 2x2 layout
- **tiff.js** - TIFF file support (loaded via CDN)

## Testing

### Generate Test Data
Run the included Python script to generate sample 3D volumes:

```bash
python generate_simple_test.py
```

This creates test data in the `test-data/` folder:
- `simple_test.raw` + `simple_test.json` - 16³ gradient volume (4 KB)
- `checker_test.raw` + `checker_test.json` - 32³ checkerboard pattern (32 KB)

### Test Workflow
1. Open `index.html` in your browser
2. Click "Open" and navigate to the `test-data/` folder
3. Select both `simple_test.raw` and `simple_test.json`
4. Verify:
   - 2x2 grid appears
   - Three orthogonal views display correctly
   - Mouse wheel navigates slices
   - Ctrl + wheel zooms all views
   - Contrast/brightness sliders work
   - Slice indicators update correctly

### Adding Your Own Data
See `test-data/README.md` for detailed instructions on how to add your own 3D CT volumes to the viewer.

## Implementation Details

### 3D Data Layout
- Data stored in **C-order (row-major)**: x varies fastest, then y, then z
- Index calculation: `index = x + y * width + z * width * height`

### Slice Extraction
- **XY (Axial)**: Contiguous data, simple slicing
- **XZ (Coronal)**: Y-stride extraction
- **YZ (Sagittal)**: XY-stride extraction

### Rendering Pipeline
1. Extract 2D slice from 3D volume
2. Normalize pixel values to 0-255 range
3. Apply contrast and brightness adjustments
4. Convert to RGBA ImageData
5. Render to canvas with zoom/pan transforms

### State Management
- Centralized state in `CTViewer`
- Observer pattern for synchronized updates
- Debounced rendering (~60fps) for smooth interactions

## Performance Considerations

- **Slice caching**: Currently extracts slices on-demand
- **Rendering**: Debounced with requestAnimationFrame
- **Memory**: Entire volume loaded into memory
- **File size limits**: Tested up to ~50MB volumes

### Recommended Volume Sizes
- **Small**: 64³ or smaller - Instant loading
- **Medium**: 128³ to 256³ - Fast loading
- **Large**: 512³ - May take a few seconds to load

## Browser Compatibility

Tested on:
- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari (may have minor rendering differences)

Requires:
- Modern browser with ES6 support
- Canvas 2D API
- File API for local file access

## Use Cases

- **Industrial CT inspection** - Non-destructive testing of manufactured parts
- **Quality control** - Defect detection and dimensional analysis
- **Materials science** - Internal structure analysis
- **Additive manufacturing** - Layer-by-layer inspection
- **Electronics** - PCB and component inspection
- **Aerospace** - Component integrity verification

## Future Enhancements

Planned features (not yet implemented):
- [ ] 3D volume rendering (WebGL)
- [ ] Compressed DICOM transfer syntaxes (JPEG/JPEG2000, RLE)
- [ ] Measurement tools (distance, angle, ROI)
- [ ] Annotations and labels
- [ ] Multi-volume comparison
- [ ] Histogram display
- [ ] Window/Level presets for different materials
- [ ] Cine mode (animation through slices)
- [ ] Export screenshots
- [ ] Crosshair synchronization between views

## Troubleshooting

### Issue: "Failed to load 3D volume"
- Verify both .raw and .json files are selected
- Check JSON metadata format is correct
- Ensure dimensions match file size: `fileSize = width × height × depth × bytesPerPixel`

### Issue: Slices appear corrupted
- Verify data is in C-order (row-major)
- Check byteOrder matches your data
- Ensure correct dataType (uint8, uint16, or float32)

### Issue: Performance is slow
- Reduce volume size
- Close other browser tabs
- Use a smaller data type (uint8 instead of uint16)

## Development

### Adding New Data Types
1. Update `VolumeData.parseRawData()` in `js/VolumeData.js`
2. Add bytesPerPixel calculation
3. Update metadata validation in `FileParser.js`

### Adding Window/Level Presets
1. Add preset to `ImageProcessor.presets` in `js/ImageProcessor.js`
2. Add UI dropdown in `index.html`
3. Wire up event listener in `script.js`

## License

This project is provided as-is for industrial inspection and research purposes.

## Credits

- Built with vanilla JavaScript for maximum compatibility
- TIFF support via [tiff.js](https://github.com/seikichi/tiff.js/)
- Dark theme optimized for CT imaging inspection
