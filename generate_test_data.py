#!/usr/bin/env python3
"""
Generate test data for the medical image viewer
Creates a simple 3D volume with gradient patterns for testing
"""

import numpy as np
import json
import os

def create_test_volume_uint8():
    """Create a simple 64x64x64 uint8 volume with gradient"""
    print("Creating 64x64x64 uint8 test volume...")

    volume = np.zeros((64, 64, 64), dtype=np.uint8)

    # Create gradient in Z direction
    for z in range(64):
        volume[:, :, z] = z * 4  # 0 to 252

    # Save RAW file
    volume.tofile('test_volume_uint8.raw')

    # Save metadata
    metadata = {
        "dimensions": [64, 64, 64],
        "dataType": "uint8",
        "byteOrder": "little-endian",
        "spacing": [1.0, 1.0, 1.0],
        "description": "Test gradient volume (uint8)"
    }

    with open('test_volume_uint8.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"  Created test_volume_uint8.raw ({os.path.getsize('test_volume_uint8.raw')} bytes)")
    print(f"  Created test_volume_uint8.json")

def create_test_volume_uint16():
    """Create a 32x32x32 uint16 volume with more complex patterns"""
    print("\nCreating 32x32x32 uint16 test volume...")

    volume = np.zeros((32, 32, 32), dtype=np.uint16)

    # Create a sphere with gradient
    center = 16
    radius = 12

    for z in range(32):
        for y in range(32):
            for x in range(32):
                dist = np.sqrt((x-center)**2 + (y-center)**2 + (z-center)**2)
                if dist < radius:
                    volume[x, y, z] = int((1 - dist/radius) * 4095)  # 0 to 4095

    # Save RAW file (in C-order / row-major)
    volume.tofile('test_volume_uint16.raw')

    # Save metadata
    metadata = {
        "dimensions": [32, 32, 32],
        "dataType": "uint16",
        "byteOrder": "little-endian",
        "spacing": [1.0, 1.0, 1.0],
        "description": "Test sphere volume (uint16)"
    }

    with open('test_volume_uint16.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"  Created test_volume_uint16.raw ({os.path.getsize('test_volume_uint16.raw')} bytes)")
    print(f"  Created test_volume_uint16.json")

def create_test_volume_checker():
    """Create a checkerboard pattern for testing orthogonal slices"""
    print("\nCreating 64x64x64 checkerboard test volume...")

    volume = np.zeros((64, 64, 64), dtype=np.uint8)

    # Create 3D checkerboard pattern
    block_size = 8
    for z in range(64):
        for y in range(64):
            for x in range(64):
                bx = (x // block_size) % 2
                by = (y // block_size) % 2
                bz = (z // block_size) % 2
                if (bx + by + bz) % 2 == 0:
                    volume[x, y, z] = 255

    # Save RAW file
    volume.tofile('test_volume_checker.raw')

    # Save metadata
    metadata = {
        "dimensions": [64, 64, 64],
        "dataType": "uint8",
        "byteOrder": "little-endian",
        "spacing": [1.0, 1.0, 1.0],
        "description": "3D checkerboard pattern"
    }

    with open('test_volume_checker.json', 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"  Created test_volume_checker.raw ({os.path.getsize('test_volume_checker.raw')} bytes)")
    print(f"  Created test_volume_checker.json")

def main():
    print("Generating test data for medical image viewer...\n")

    create_test_volume_uint8()
    create_test_volume_uint16()
    create_test_volume_checker()

    print("\n✓ Test data generation complete!")
    print("\nTo test:")
    print("1. Open index.html in a web browser")
    print("2. Click 'Open' and select both .raw and .json files (e.g., test_volume_uint8.raw + test_volume_uint8.json)")
    print("3. The viewer should switch to medical mode and display the 3D volume")

if __name__ == "__main__":
    main()
