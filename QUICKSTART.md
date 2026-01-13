# Quick Start Guide

## Getting Started in 3 Steps

### 1. Generate Test Data
```bash
python generate_simple_test.py
```

This creates test CT volumes you can load immediately.

### 2. Open the Viewer
Simply open `index.html` in your web browser (Chrome, Firefox, or Edge recommended).

### 3. Load a 3D CT Volume
1. Click the "Open" button
2. Navigate to the `test-data/` folder
3. Select **both** files:
   - `simple_test.raw`
   - `simple_test.json`
4. The viewer will automatically switch to CT mode

## What You'll See

The viewer displays a **2x2 grid** with:
- **Top-left**: XY view (Axial) - horizontal slices
- **Top-right**: XZ view (Coronal) - frontal slices
- **Bottom-left**: YZ view (Sagittal) - side slices
- **Bottom-right**: 3D rendering placeholder (coming soon)

## Controls

### Navigation
- **Mouse wheel** (no Ctrl): Scroll through slices in the active view
- **Ctrl + Mouse wheel**: Zoom all views simultaneously
- **Click and drag**: Pan all views simultaneously

### Adjustments (Works for both 2D and 3D)
- **Contrast slider**: Adjust image contrast (0.5 - 2.0, default 1.0)
- **Brightness slider**: Adjust brightness (-100 to +100, default 0)
- These controls work for both standard 2D images and 3D CT volumes

### Buttons
- **Zoom In/Out**: Buttons to zoom
- **Reset**: Reset zoom, pan, contrast, and brightness to defaults

## Testing Different Volumes

### Simple Gradient Volume (16×16×16)
Best for: Quick testing, understanding slice navigation

**What to expect:**
- Slices get brighter as you scroll through them
- Very fast to load

### Checkerboard Pattern (32×32×32)
Best for: Testing orthogonal slice extraction

**What to expect:**
- 3D checkerboard pattern
- Different pattern in each view
- Good for verifying slice accuracy

## Loading Your Own CT Data

### Quick Overview
You need **TWO files**:
1. `.raw` - Binary volume data
2. `.json` - Metadata describing the volume

Place them in the `test-data/` folder (or anywhere you prefer).

### Metadata Format
```json
{
  "dimensions": [width, height, depth],
  "dataType": "uint8|uint16|float32",
  "byteOrder": "little-endian",
  "spacing": [1.0, 1.0, 1.0],
  "description": "My CT volume"
}
```

### Key Requirements
- **Data layout**: C-order (row-major) - X varies fastest, then Y, then Z
- **File size**: Must exactly match `width × height × depth × bytes_per_voxel`

**For detailed instructions**, see `test-data/README.md` which includes:
- Supported data types and formats
- Python and MATLAB examples
- File size calculations
- Troubleshooting common issues

## Troubleshooting

### "No valid files selected"
→ Make sure you selected **both** .raw and .json files

### Slices look wrong/corrupted
→ Check your data is in C-order (row-major)
→ Verify dimensions in JSON match actual file size

### Viewer doesn't load
→ Open browser console (F12) to see error messages
→ Check all JavaScript files loaded correctly

## Industrial CT Use Cases

This viewer is designed for:
- **Non-destructive testing** of manufactured components
- **Quality inspection** of castings, welds, and assemblies
- **Defect detection** in materials and parts
- **Dimensional analysis** of internal features
- **Additive manufacturing** inspection (layer analysis)
- **Electronics inspection** (PCB voids, solder joints)

## Next Steps

- Try loading your own industrial CT scan data
- Experiment with contrast and brightness controls
- Navigate through slices in different views
- Test zoom and pan synchronization

For more details, see [README.md](README.md)
