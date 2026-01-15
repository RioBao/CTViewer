/**
 * MIP (Maximum Intensity Projection) Raycaster
 * CPU-based volume rendering for CT data visualization
 */
class MIPRaycaster {
    constructor() {
        this.volume = null;
        this.dimensions = [0, 0, 0];
        this.dataMin = 0;
        this.dataMax = 1;
        // Display range for windowing (defaults to data range)
        this.displayMin = 0;
        this.displayMax = 1;
    }

    /**
     * Set volume data for rendering
     * @param {VolumeData} volumeData
     */
    setVolume(volumeData) {
        this.volume = volumeData;
        this.dimensions = volumeData.dimensions;
        this.dataMin = volumeData.min;
        this.dataMax = volumeData.max;
        // Default display range to full data range
        this.displayMin = volumeData.min;
        this.displayMax = volumeData.max;
    }

    /**
     * Set display range for windowing
     * Values below displayMin map to 0, values at/above displayMax map to 1
     * @param {number} min - Low value
     * @param {number} max - High value
     */
    setDisplayRange(min, max) {
        this.displayMin = min;
        this.displayMax = max;
    }

    /**
     * Render MIP projection to ImageData
     * @param {ImageData} imageData - Output buffer
     * @param {object} camera - Camera parameters {azimuth, elevation, distance}
     * @param {object} settings - Render settings {stepSize, threshold}
     */
    render(imageData, camera, settings) {
        if (!this.volume) return;

        const width = imageData.width;
        const height = imageData.height;
        const pixels = imageData.data;

        const [nx, ny, nz] = this.dimensions;
        const data = this.volume.data;

        // Volume center (rotation pivot)
        const cx = nx / 2;
        const cy = ny / 2;
        const cz = nz / 2;

        // Compute rotation matrices from camera angles
        const azRad = camera.azimuth * Math.PI / 180;
        const elRad = camera.elevation * Math.PI / 180;

        // Rotation matrix components (Y-axis rotation for azimuth, X-axis for elevation)
        const cosAz = Math.cos(azRad);
        const sinAz = Math.sin(azRad);
        const cosEl = Math.cos(elRad);
        const sinEl = Math.sin(elRad);

        // Combined rotation: first elevation (X), then azimuth (Y)
        // Forward direction (into screen)
        const fwdX = sinAz * cosEl;
        const fwdY = -sinEl;
        const fwdZ = cosAz * cosEl;

        // Right direction
        const rightX = cosAz;
        const rightY = 0;
        const rightZ = -sinAz;

        // Up direction
        const upX = sinAz * sinEl;
        const upY = cosEl;
        const upZ = cosAz * sinEl;

        // Calculate view bounds - project all 8 corners of volume
        const corners = [
            [0, 0, 0], [nx, 0, 0], [0, ny, 0], [0, 0, nz],
            [nx, ny, 0], [nx, 0, nz], [0, ny, nz], [nx, ny, nz]
        ];

        let minU = Infinity, maxU = -Infinity;
        let minV = Infinity, maxV = -Infinity;
        let minW = Infinity, maxW = -Infinity;

        for (const [px, py, pz] of corners) {
            // Translate to center
            const dx = px - cx;
            const dy = py - cy;
            const dz = pz - cz;

            // Project to view space
            const u = dx * rightX + dy * rightY + dz * rightZ;
            const v = dx * upX + dy * upY + dz * upZ;
            const w = dx * fwdX + dy * fwdY + dz * fwdZ;

            minU = Math.min(minU, u);
            maxU = Math.max(maxU, u);
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
            minW = Math.min(minW, w);
            maxW = Math.max(maxW, w);
        }

        // View scale (fit volume in viewport with some padding)
        const viewSize = Math.max(maxU - minU, maxV - minV);
        const scale = (Math.min(width, height) * 0.9) / viewSize / camera.distance;

        // Ray step size in world units
        const stepSize = settings.stepSize || 1.0;
        const threshold = settings.threshold || 0;

        // Display range for normalization (windowing)
        const displayRange = this.displayMax - this.displayMin;

        // For each pixel, cast a ray
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                // Convert pixel to view-space coordinates
                const u = (px - width / 2) / scale;
                const v = (height / 2 - py) / scale; // Flip Y

                // Ray origin in world space (orthographic projection)
                const rayOx = cx + u * rightX + v * upX + minW * fwdX;
                const rayOy = cy + u * rightY + v * upY + minW * fwdY;
                const rayOz = cz + u * rightZ + v * upZ + minW * fwdZ;

                // Ray direction (forward into volume)
                const rayDx = fwdX;
                const rayDy = fwdY;
                const rayDz = fwdZ;

                // March through volume
                let maxValue = -Infinity;
                const rayLength = maxW - minW;
                const numSteps = Math.ceil(rayLength / stepSize);

                for (let i = 0; i <= numSteps; i++) {
                    const t = i * stepSize;

                    // Current position along ray
                    const x = rayOx + t * rayDx;
                    const y = rayOy + t * rayDy;
                    const z = rayOz + t * rayDz;

                    // Nearest neighbor sampling (fast)
                    const ix = Math.floor(x);
                    const iy = Math.floor(y);
                    const iz = Math.floor(z);

                    // Bounds check
                    if (ix >= 0 && ix < nx && iy >= 0 && iy < ny && iz >= 0 && iz < nz) {
                        const idx = ix + iy * nx + iz * nx * ny;
                        const value = data[idx];

                        if (value > maxValue) {
                            maxValue = value;

                            // Early termination if we hit maximum possible value
                            if (maxValue >= this.dataMax) break;
                        }
                    }
                }

                // Apply threshold
                if (maxValue < threshold) {
                    maxValue = this.dataMin;
                }

                // Normalize to 0-255 using display range (windowing)
                // Values <= displayMin map to 0, values >= displayMax map to 255
                let normalized;
                if (maxValue <= this.displayMin || displayRange === 0) {
                    normalized = 0;
                } else if (maxValue >= this.displayMax) {
                    normalized = 255;
                } else {
                    normalized = Math.floor(((maxValue - this.displayMin) / displayRange) * 255);
                }

                // Write pixel (grayscale)
                const pixelIdx = (py * width + px) * 4;
                pixels[pixelIdx] = normalized;
                pixels[pixelIdx + 1] = normalized;
                pixels[pixelIdx + 2] = normalized;
                pixels[pixelIdx + 3] = 255;
            }
        }
    }
}
