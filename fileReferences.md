# File References

Quick reference for all files in the Industrial CT Viewer project. Use this to search and navigate the codebase efficiently.

---

## Core Application

| File | Namespace/Class | Description |
|------|-----------------|-------------|
| [index.html](./index.html) | - | Main HTML entry point, defines UI layout and loads all scripts |
| [script.js](./script.js) | `ImageViewer` | Main application controller, orchestrates mode switching and UI events |
| [style.css](./style.css) | - | Application styles, dark theme, responsive layout, 2x2 grid for CT view |

---

## JavaScript Modules (`js/`)

### Volume Data & Loading

| File | Namespace/Class | Description |
|------|-----------------|-------------|
| [js/VolumeData.js](./js/VolumeData.js) | `VolumeData` | Core 3D volume container. Parses raw binary data, extracts 2D slices (XY/XZ/YZ), calculates min/max. Data layout: C-order (x varies fastest) |
| [js/ProgressiveVolumeData.js](./js/ProgressiveVolumeData.js) | `ProgressiveVolumeData` | Mixed-resolution volume with Z-axis block tiling. Returns high-res or upscaled low-res slices based on block load state |
| [js/StreamingVolumeData.js](./js/StreamingVolumeData.js) | `StreamingVolumeData` | On-demand slice reading for very large volumes (>1GB). Never loads full volume into memory |
| [js/ProgressiveVolumeLoader.js](./js/ProgressiveVolumeLoader.js) | `ProgressiveVolumeLoader` | Handles progressive loading with Z-axis tiling. Creates low-res preview, then loads blocks. Uses streaming for files >1GB |
| [js/FileParser.js](./js/FileParser.js) | `FileParser` | File type detection and grouping. Pairs .raw with .json metadata, validates schema, loads TIFF/images |

### CT Viewer & Rendering

| File | Namespace/Class | Description |
|------|-----------------|-------------|
| [js/CTViewer.js](./js/CTViewer.js) | `CTViewer` | State management hub for 3D volume viewing. Coordinates zoom/pan across views, handles crosshairs, ROI selection, slice navigation |
| [js/SliceRenderer.js](./js/SliceRenderer.js) | `SliceRenderer` | Per-canvas 2D slice renderer. Normalizes data, applies contrast/brightness, handles zoom/pan transforms |
| [js/ImageProcessor.js](./js/ImageProcessor.js) | `ImageProcessor` | Contrast/brightness calculations, window/level presets (lung, bone, soft-tissue, brain, liver) |
| [js/Histogram.js](./js/Histogram.js) | `Histogram` | Interactive histogram display with draggable min/max handles for window/level adjustment |

### 3D Volume Rendering

| File | Namespace/Class | Description |
|------|-----------------|-------------|
| [js/VolumeRenderer3D.js](./js/VolumeRenderer3D.js) | `VolumeRenderer3D` | 3D volume renderer controller. Manages camera, mouse interaction (track/pan), progressive quality. Uses WebGL2 or CPU fallback |
| [js/WebGLMIPRenderer.js](./js/WebGLMIPRenderer.js) | `WebGLMIPRenderer` | GPU-accelerated MIP rendering. Uploads 3D textures, manages shaders, handles display range/gamma |
| [js/WebGLShaders.js](./js/WebGLShaders.js) | `WebGLShaders` | GLSL shader sources for MIP ray marching. Vertex shader for fullscreen quad, fragment shader for volume sampling |
| [js/WebGLUtils.js](./js/WebGLUtils.js) | `WebGLUtils` | WebGL2 utilities. Context creation, shader compilation, GPU memory estimation, error handling |
| [js/MIPRaycaster.js](./js/MIPRaycaster.js) | `MIPRaycaster` | CPU-based MIP raycaster fallback. Used when WebGL2 unavailable or fails |

### External Libraries

| File | Namespace/Class | Description |
|------|-----------------|-------------|
| [js/tiff.min.js](./js/tiff.min.js) | `Tiff` | TIFF image parser library (tiff.js by seikichi). Handles multi-page TIFF, various bit depths |

---

## Python Utilities

| File | Description |
|------|-------------|
| [generate_simple_test.py](./generate_simple_test.py) | Creates small 16x16x16 test volume without numpy dependency |
| [generate_test_data.py](./generate_test_data.py) | Creates 64x64x64 test volumes with gradient patterns (requires numpy) |

---

## Documentation

| File | Description |
|------|-------------|
| [README.md](./README.md) | Project overview and main documentation |
| [CLAUDE.md](./CLAUDE.md) | AI assistant context: architecture, key classes, data flow |
| [QUICKSTART.md](./QUICKSTART.md) | Quick start guide for users |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | Project requirements and specifications |
| [CHANGELOG.md](./CHANGELOG.md) | Version history and changes |
| [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) | Notes for migrating between versions |

---

## Test Data

| File | Description |
|------|-------------|
| [test-data/README.md](./test-data/README.md) | Test data documentation |
| [test-data/simple_test.json](./test-data/simple_test.json) | Metadata for simple test volume |
| [test-data/checker_test.json](./test-data/checker_test.json) | Metadata for checker pattern test volume |

---

## Key Data Flow

```
User drops files
       │
       ▼
FileParser.groupFiles() ──► pairs .raw + .json
       │
       ▼
FileParser.load3DVolume() ──► VolumeData or ProgressiveVolumeData
       │
       ▼
CTViewer.loadVolume() ──► manages state, creates SliceRenderers
       │
       ├──► VolumeData.getSlice(axis, index) ──► 2D slice extraction
       │           │
       │           ▼
       │    SliceRenderer.render() ──► ImageProcessor ──► canvas
       │
       └──► VolumeRenderer3D.loadVolume() ──► 3D MIP rendering
                    │
                    ├──► WebGLMIPRenderer (GPU)
                    └──► MIPRaycaster (CPU fallback)
```

---

## Mouse Controls (3D View)

| Action | Control |
|--------|---------|
| Track (rotate) | Left mouse button |
| Pan (translate) | Both mouse buttons |
| Zoom | Scroll wheel |

---

## Volume Format

Requires two files with matching base names:
- `volume.raw` - Binary voxel data (no header)
- `volume.json` - Metadata

```json
{
  "dimensions": [width, height, depth],
  "dataType": "uint8|uint16|float32",
  "byteOrder": "little-endian",
  "spacing": [1.0, 1.0, 1.0]
}
```
