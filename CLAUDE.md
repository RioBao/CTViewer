# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Industrial CT Viewer - a vanilla JavaScript web application for viewing 2D images and 3D CT (Computed Tomography) volumes. Opens directly in browser via `index.html` (no build step required).

## Development

**Run the application:** Open `index.html` in a browser (Chrome/Edge recommended).

**Generate test data:**
```bash
python generate_simple_test.py
```
Creates test volumes in `test-data/` folder for manual testing.

**Testing:** Manual browser testing. Load test data by selecting both `.raw` and `.json` files together.

## Architecture

### Mode Switching
The app operates in two modes controlled by `ImageViewer.currentMode`:
- **standard**: 2D image viewing (single image with thumbnails)
- **ct**: 3D volume viewing (2x2 grid with three orthogonal slice views)

`script.js` contains the main `ImageViewer` class that orchestrates mode switching and delegates to specialized components.

### 3D Volume Pipeline

```
FileParser.groupFiles() → pairs .raw + .json files
    ↓
FileParser.load3DVolume() → returns VolumeData
    ↓
CTViewer.loadVolume() → manages state, creates SliceRenderers
    ↓
VolumeData.getSlice(axis, index) → extracts 2D slice
    ↓
SliceRenderer.render() → applies ImageProcessor, draws to canvas
```

### Key Classes (js/ folder)

- **VolumeData**: Holds raw 3D data, extracts slices. Data layout is C-order (x varies fastest): `index = x + y*width + z*width*height`
- **CTViewer**: State management hub. Coordinates zoom/pan across all views, handles input events, debounces rendering (~60fps)
- **SliceRenderer**: Per-canvas renderer. Normalizes data, applies contrast/brightness via ImageProcessor, handles zoom/pan transforms
- **ImageProcessor**: Contrast/brightness calculations, window/level presets (lung, bone, soft-tissue, etc.)
- **FileParser**: Detects file types, pairs `.raw` with `.json` metadata, validates metadata schema

### Slice Extraction
- **XY (Axial)**: Contiguous memory, simple slice
- **XZ (Coronal)**: Y-stride extraction (loop over z, x)
- **YZ (Sagittal)**: XY-stride extraction (loop over z, y)

### Event Communication
Uses CustomEvents on `document` for loose coupling:
- `slicechange`: Updates slice indicators
- `zoomchange`: Updates zoom display

## 3D Volume Format

Requires two files with matching base names:
- `volume.raw`: Binary data (no header)
- `volume.json`: Metadata

```json
{
  "dimensions": [width, height, depth],
  "dataType": "uint8|uint16|float32",
  "byteOrder": "little-endian",
  "spacing": [1.0, 1.0, 1.0]
}
```

File size must match: `width × height × depth × bytesPerVoxel`
