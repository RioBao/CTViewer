# Test Data Directory

This folder contains sample 3D volumes for testing the medical image viewer.

## Included Test Volumes

### simple_test (16×16×16, uint8)
- **Size**: 4 KB
- **Pattern**: Gradient in Z direction
- **Use**: Quick testing, basic functionality verification
- **Files**: `simple_test.raw` + `simple_test.json`

### checker_test (32×32×32, uint8)
- **Size**: 32 KB
- **Pattern**: 3D checkerboard (8×8×8 blocks)
- **Use**: Testing orthogonal slice extraction accuracy
- **Files**: `checker_test.raw` + `checker_test.json`

## Adding Your Own Data

### Format Requirements

You need **TWO files** for each 3D volume:

1. **`.raw` file** - Binary volume data
   - Raw binary format (no header)
   - Data layout: C-order (row-major)
   - Index: `x + y*width + z*width*height`

2. **`.json` file** - Metadata with same base name

### JSON Metadata Format

```json
{
  "dimensions": [width, height, depth],
  "dataType": "uint8|uint16|float32",
  "byteOrder": "little-endian",
  "spacing": [x_spacing, y_spacing, z_spacing],
  "description": "Optional description"
}
```

### Supported Data Types

| dataType | Bytes per voxel | Range | Use case |
|----------|-----------------|-------|----------|
| `uint8` | 1 | 0-255 | Small volumes, 8-bit images |
| `uint16` | 2 | 0-65535 | CT scans, 16-bit microscopy |
| `float32` | 4 | Any float | Normalized data, simulations |

### File Size Calculation

Your `.raw` file size must exactly match:

```
file_size = width × height × depth × bytes_per_voxel
```

**Examples:**
- 64×64×64 uint8: 64 × 64 × 64 × 1 = 262,144 bytes
- 128×128×100 uint16: 128 × 128 × 100 × 2 = 3,276,800 bytes
- 256×256×256 float32: 256 × 256 × 256 × 4 = 67,108,864 bytes

### Example: Converting Your Data

#### Python Example (with numpy)
```python
import numpy as np
import json

# Your volume data (numpy array)
volume = np.random.randint(0, 256, (64, 64, 64), dtype=np.uint8)

# Save RAW file (C-order / row-major)
volume.tofile('test-data/my_volume.raw')

# Create metadata
metadata = {
    "dimensions": [64, 64, 64],
    "dataType": "uint8",
    "byteOrder": "little-endian",
    "spacing": [1.0, 1.0, 1.0],
    "description": "My custom volume"
}

with open('test-data/my_volume.json', 'w') as f:
    json.dump(metadata, f, indent=2)
```

#### MATLAB Example
```matlab
% Your volume data (3D array)
volume = uint8(randi([0 255], 64, 64, 64));

% MATLAB uses column-major, need to permute for C-order
volume_c_order = permute(volume, [2 1 3]);

% Save RAW file
fid = fopen('test-data/my_volume.raw', 'wb');
fwrite(fid, volume_c_order, 'uint8');
fclose(fid);

% Create metadata JSON manually or using jsonencode
metadata = struct(...
    'dimensions', [64, 64, 64], ...
    'dataType', 'uint8', ...
    'byteOrder', 'little-endian', ...
    'spacing', [1.0, 1.0, 1.0], ...
    'description', 'My custom volume');

fid = fopen('test-data/my_volume.json', 'w');
fprintf(fid, '%s', jsonencode(metadata));
fclose(fid);
```

### Data Layout (C-order / Row-major)

The data must be stored with **X varying fastest**, then Y, then Z:

```
[0,0,0], [1,0,0], [2,0,0], ... [width-1,0,0],
[0,1,0], [1,1,0], [2,1,0], ... [width-1,1,0],
...
[0,0,1], [1,0,1], [2,0,1], ... [width-1,0,1],
...
```

This is the default for:
- ✅ Python numpy (`.tofile()`)
- ✅ C/C++ (row-major arrays)
- ❌ MATLAB (needs `permute` - column-major by default)
- ❌ Fortran (needs transposition - column-major)

### Troubleshooting

**Error: "Buffer size mismatch"**
→ File size doesn't match dimensions × bytes per voxel
→ Check file size and recalculate

**Slices look scrambled**
→ Wrong data layout (not C-order)
→ Try transposing/permuting your array before saving

**Values look wrong**
→ Wrong dataType in JSON
→ Wrong byteOrder (should be little-endian)

**Can't see anything (all black/white)**
→ Data range might be outside 0-255 after normalization
→ Use contrast/brightness sliders to adjust

### Tips for Good Test Data

- **Start small**: 16×16×16 or 32×32×32 for quick testing
- **Use patterns**: Gradients, checkerboards, or spheres make slice orientation obvious
- **Test edge cases**: Try non-cubic volumes (e.g., 128×128×64)
- **Check your math**: Always verify file size matches dimensions

### Organizing Your Data

Feel free to organize test data however you like:

```
test-data/
├── simple_test.raw/.json          # Provided samples
├── checker_test.raw/.json         # Provided samples
├── my_ct_scan.raw/.json           # Your data
├── microscopy/                     # Organize by type
│   ├── sample1.raw/.json
│   └── sample2.raw/.json
└── simulations/
    ├── fluid_sim.raw/.json
    └── thermal_sim.raw/.json
```

The viewer will load any RAW+JSON pair you select, regardless of folder structure.
