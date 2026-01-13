# Changelog

## v1.1 - Industrial CT Focus

### Changed
- **Rebranded from Medical Image Viewer to Industrial CT Viewer**
  - Updated all documentation to reflect industrial CT / NDT use cases
  - Changed terminology throughout codebase
  - Renamed `MedicalViewer.js` to `CTViewer.js`
  - Updated CSS class names (`.medical-*` → `.ct-*`)
  - Updated HTML IDs (`medicalControls` → `ctControls`, etc.)

### Use Cases
- Industrial CT inspection and non-destructive testing
- Quality control and defect detection
- Additive manufacturing inspection
- Electronics and PCB analysis
- Aerospace component verification
- Materials science research

## v1.0 - Contrast/Brightness for 2D Images

### Added
- **Contrast and brightness controls for 2D images**
  - Controls are now visible in both 2D and 3D modes
  - Slice indicators automatically hide when viewing 2D images
  - Contrast range: 0.5 to 2.0 (1.0 = normal)
  - Brightness range: -100 to +100 (0 = normal)

### Implementation Details
- **2D Mode**: Uses CSS filters (`filter: contrast() brightness()`)
  - Efficient, hardware-accelerated
  - No canvas manipulation needed
  - Instant visual feedback

- **3D Mode**: Uses canvas-based ImageData manipulation
  - Pixel-level control for CT imaging
  - Applied during rendering pipeline

### User Experience Improvements
- Contrast/brightness settings persist when navigating between 2D images
- Reset button restores both zoom/pan AND contrast/brightness to defaults
- Smooth transitions with no lag or flicker

### Files Modified
- `index.html`: Added ID to slice controls div for conditional hiding
- `script.js`:
  - Added `apply2DImageFilters()` method for CSS filter application
  - Added `resetFilters()` method to reset contrast/brightness
  - Updated `switchToStandardMode()` to show controls and hide slice indicators
  - Updated `switchToCTMode()` to show slice indicators
  - Enhanced slider event handlers to work in both modes
  - Updated `displayImage()` to apply filters to new images
  - Updated Reset button to reset both view and filters
- `README.md`: Updated features and usage documentation
- `QUICKSTART.md`: Updated to reflect controls work in both modes

## v0.9 - Initial Release

### Features
- **2D Image Viewing**
  - Multiple image support with thumbnails
  - Zoom, pan, navigation
  - Drag and drop
  - Keyboard shortcuts

- **3D CT Volume Viewing**
  - 2x2 orthogonal slice layout (Axial, Coronal, Sagittal)
  - RAW binary format with JSON metadata
  - Synchronized zoom and pan
  - Mouse wheel slice navigation
  - Support for uint8, uint16, float32 data types

- **Modular Architecture**
  - VolumeData.js - 3D data handling
  - SliceRenderer.js - Canvas rendering
  - ImageProcessor.js - Image processing algorithms
  - FileParser.js - File loading and parsing
  - CTViewer.js - 3D viewer orchestration

### Test Data
- Organized in `test-data/` folder
- Sample gradient volume (16³)
- Checkerboard pattern volume (32³)
- Test data generator script included
