#!/usr/bin/env python3
"""
Simple test data generator without numpy dependency
Creates a small 3D volume for testing the medical image viewer
"""

import json
import struct
import os

# Ensure test-data directory exists
os.makedirs('test-data', exist_ok=True)

def create_simple_test_volume():
    """Create a tiny 16x16x16 uint8 volume with gradient"""
    print("Creating 16x16x16 uint8 test volume...")

    width, height, depth = 16, 16, 16

    # Create binary data with gradient in Z direction
    data = bytearray()

    for z in range(depth):
        for y in range(height):
            for x in range(width):
                # Simple gradient: value increases with z
                value = (z * 255) // (depth - 1)
                data.append(value)

    # Write RAW file
    with open('test-data/simple_test.raw', 'wb') as f:
        f.write(data)

    # Write metadata
    metadata = {
        "dimensions": [width, height, depth],
        "dataType": "uint8",
        "byteOrder": "little-endian",
        "spacing": [1.0, 1.0, 1.0],
        "description": "Simple 16x16x16 gradient test volume"
    }

    with open('test-data/simple_test.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"[OK] Created simple_test.raw ({len(data)} bytes)")
    print(f"[OK] Created simple_test.json")
    print(f"\nVolume info: {width}×{height}×{depth} = {width*height*depth} voxels")

def create_checkerboard_test():
    """Create a 32x32x32 checkerboard pattern"""
    print("\nCreating 32x32x32 checkerboard pattern...")

    width, height, depth = 32, 32, 32

    data = bytearray()

    for z in range(depth):
        for y in range(height):
            for x in range(width):
                # 8x8x8 checkerboard blocks
                bx = (x // 8) % 2
                by = (y // 8) % 2
                bz = (z // 8) % 2
                value = 255 if (bx + by + bz) % 2 == 0 else 0
                data.append(value)

    with open('test-data/checker_test.raw', 'wb') as f:
        f.write(data)

    metadata = {
        "dimensions": [width, height, depth],
        "dataType": "uint8",
        "byteOrder": "little-endian",
        "spacing": [1.0, 1.0, 1.0],
        "description": "32x32x32 checkerboard pattern"
    }

    with open('test-data/checker_test.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"[OK] Created checker_test.raw ({len(data)} bytes)")
    print(f"[OK] Created checker_test.json")

if __name__ == "__main__":
    print("=" * 60)
    print("Medical Image Viewer - Test Data Generator")
    print("=" * 60)
    print()

    create_simple_test_volume()
    create_checkerboard_test()

    print("\n" + "=" * 60)
    print("Test data generation complete!")
    print("=" * 60)
    print("\nHow to test:")
    print("1. Open index.html in your web browser")
    print("2. Click the 'Open' button")
    print("3. Navigate to the test-data/ folder")
    print("4. Select BOTH files:")
    print("   - simple_test.raw")
    print("   - simple_test.json")
    print("5. The viewer should display a 2x2 grid with three orthogonal views")
    print("\nExpected behavior:")
    print("- XY view: Should show gradient (dark to bright as you scroll through slices)")
    print("- XZ view: Should show vertical gradient")
    print("- YZ view: Should show vertical gradient")
    print("- Use mouse wheel to navigate through slices")
    print("- Use Ctrl+wheel to zoom")
    print("- Click and drag to pan")
    print()
