/**
 * WebGL2 Shader Sources for MIP Volume Rendering
 */
const WebGLShaders = {
    /**
     * Vertex shader - renders a full-screen quad
     * Uses gl_VertexID to generate vertices without a vertex buffer
     */
    vertex: `#version 300 es
precision highp float;

// Full-screen quad vertices (2 triangles)
const vec2 positions[6] = vec2[](
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
    vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0)
);

out vec2 vUV;

void main() {
    vec2 pos = positions[gl_VertexID];
    vUV = pos * 0.5 + 0.5;  // Convert from [-1,1] to [0,1]
    gl_Position = vec4(pos, 0.0, 1.0);
}
`,

    /**
     * Fragment shader - MIP ray marching
     * Matches the CPU MIPRaycaster behavior
     */
    fragment: `#version 300 es
precision highp float;
precision highp sampler3D;

// Volume texture (normalized to [0,1])
uniform sampler3D uVolume;

// Camera parameters
uniform float uAzimuth;      // Horizontal rotation (radians)
uniform float uElevation;    // Vertical rotation (radians)
uniform float uDistance;     // Zoom factor (1.0 = fit)
uniform vec2 uPan;           // Screen-space pan offset (normalized)

// Volume dimensions for aspect ratio
uniform vec3 uDimensions;

// Display parameters (in normalized [0,1] space)
uniform float uDisplayMin;   // Window low (normalized)
uniform float uDisplayMax;   // Window high (normalized)
uniform float uGamma;        // Gamma correction

// Ray marching parameters
uniform float uStepSize;     // Step size in normalized coordinates
uniform int uNumSteps;       // Maximum number of steps

in vec2 vUV;
out vec4 fragColor;

void main() {
    // Calculate rotation matrices from camera angles
    // Match CPU: Y-axis rotation for azimuth, X-axis for elevation
    float cosAz = cos(uAzimuth);
    float sinAz = sin(uAzimuth);
    float cosEl = cos(uElevation);
    float sinEl = sin(uElevation);

    // Forward direction (viewing into volume)
    vec3 forward = vec3(sinAz * cosEl, -sinEl, cosAz * cosEl);
    // Right direction
    vec3 right = vec3(cosAz, 0.0, -sinAz);
    // Up direction
    vec3 up = vec3(sinAz * sinEl, cosEl, cosAz * sinEl);

    // Convert UV to centered coordinates [-1, 1]
    vec2 uv = (vUV - 0.5) * 2.0;

    // Apply pan offset (in normalized screen space)
    uv -= uPan;

    // Apply zoom (distance)
    uv /= uDistance;

    // Calculate aspect ratio (normalize so largest dimension = 1)
    float maxDim = max(max(uDimensions.x, uDimensions.y), uDimensions.z);
    vec3 volSize = uDimensions / maxDim;  // e.g., [1.0, 0.89, 0.22] for 807x719x178

    // Work in aspect-corrected space where volume is volSize, centered at origin
    // Ray origin: start behind the volume
    vec3 rayOrigin = right * uv.x * 0.5 * volSize.x
                   + up * uv.y * 0.5 * volSize.y
                   - forward * 1.0;

    // Ray direction (unit vector)
    vec3 rayDir = forward;

    // Volume bounds in aspect-corrected space: [-volSize/2, +volSize/2]
    vec3 volMin = -volSize * 0.5;
    vec3 volMax = volSize * 0.5;

    // Display range for windowing
    float displayRange = uDisplayMax - uDisplayMin;

    // Opacity-weighted MIP
    float maxValue = 0.0;
    vec3 pos = rayOrigin;

    for (int i = 0; i < uNumSteps; i++) {
        // Check if inside volume bounds
        if (all(greaterThanEqual(pos, volMin)) && all(lessThan(pos, volMax))) {
            // Convert to texture coordinates [0, 1]
            vec3 texCoord = (pos - volMin) / volSize;
            float value = texture(uVolume, texCoord).r;

            // Apply windowing
            float normalized;
            if (value <= uDisplayMin || displayRange <= 0.0) {
                normalized = 0.0;
            } else if (value >= uDisplayMax) {
                normalized = 1.0;
            } else {
                normalized = (value - uDisplayMin) / displayRange;
            }

            // Apply gamma
            float intensity = pow(normalized, uGamma);

            // Opacity-weighted MIP: use intensity as its own opacity
            // This creates intensity² response, emphasizing bright values
            maxValue = max(maxValue, intensity * intensity);
        }

        // Move to next position
        pos += rayDir * uStepSize;
    }

    // Output MIP result
    fragColor = vec4(vec3(maxValue), 1.0);
}
`
};
