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
uniform sampler3D uOccupancy;

// Camera parameters
uniform float uAzimuth;      // Horizontal rotation (radians)
uniform float uElevation;    // Vertical rotation (radians)
uniform float uRoll;         // Rotation around world Z (radians)
uniform float uDistance;     // Zoom factor (1.0 = fit)
uniform vec2 uPan;           // Screen-space pan offset (normalized)

// Volume dimensions for aspect ratio
uniform vec3 uDimensions;

// Display parameters (in normalized [0,1] space)
uniform float uDisplayMin;   // Window low (normalized)
uniform float uDisplayMax;   // Window high (normalized)
uniform float uGamma;        // Gamma correction
uniform float uEnableLowResAA; // 1.0 = enable lightweight 8-tap smoothing
uniform float uEnableEmptySpaceSkipping; // 1.0 = use occupancy-guided skipping
uniform float uUseAdvancedRayMarch; // 1.0 = advanced high-quality march path
uniform vec3 uOccupancyDims; // occupancy texture dimensions (brick grid)
uniform float uSkipThreshold; // skip brick if max <= threshold
uniform float uSkipEpsilon;   // tiny nudge to avoid boundary stalls

// Ray marching parameters
uniform float uStepSize;     // Step size in normalized coordinates
uniform int uNumSteps;       // Maximum number of steps

in vec2 vUV;
out vec4 fragColor;

float sampleVolume8Tap(vec3 texCoord, vec3 texelSize) {
    vec3 o = texelSize * 0.5;
    float sum = 0.0;
    sum += texture(uVolume, texCoord + vec3(-o.x, -o.y, -o.z)).r;
    sum += texture(uVolume, texCoord + vec3(-o.x, -o.y,  o.z)).r;
    sum += texture(uVolume, texCoord + vec3(-o.x,  o.y, -o.z)).r;
    sum += texture(uVolume, texCoord + vec3(-o.x,  o.y,  o.z)).r;
    sum += texture(uVolume, texCoord + vec3( o.x, -o.y, -o.z)).r;
    sum += texture(uVolume, texCoord + vec3( o.x, -o.y,  o.z)).r;
    sum += texture(uVolume, texCoord + vec3( o.x,  o.y, -o.z)).r;
    sum += texture(uVolume, texCoord + vec3( o.x,  o.y,  o.z)).r;
    return sum * 0.125;
}

float computeSkipDistance(vec3 texCoord, vec3 rayDirTex, vec3 occDims) {
    vec3 occCoord = floor(texCoord * occDims);
    vec3 cellMin = occCoord / occDims;
    vec3 cellMax = (occCoord + vec3(1.0)) / occDims;

    float tx = 1e9;
    float ty = 1e9;
    float tz = 1e9;

    if (rayDirTex.x > 1e-6) {
        tx = (cellMax.x - texCoord.x) / rayDirTex.x;
    } else if (rayDirTex.x < -1e-6) {
        tx = (cellMin.x - texCoord.x) / rayDirTex.x;
    }

    if (rayDirTex.y > 1e-6) {
        ty = (cellMax.y - texCoord.y) / rayDirTex.y;
    } else if (rayDirTex.y < -1e-6) {
        ty = (cellMin.y - texCoord.y) / rayDirTex.y;
    }

    if (rayDirTex.z > 1e-6) {
        tz = (cellMax.z - texCoord.z) / rayDirTex.z;
    } else if (rayDirTex.z < -1e-6) {
        tz = (cellMin.z - texCoord.z) / rayDirTex.z;
    }

    if (tx <= 0.0) tx = 1e9;
    if (ty <= 0.0) ty = 1e9;
    if (tz <= 0.0) tz = 1e9;
    return min(tx, min(ty, tz));
}

void main() {
    // Calculate rotation matrices from camera angles
    // Match CPU: Y-axis rotation for azimuth, X-axis for elevation, roll about forward
    float cosAz = cos(uAzimuth);
    float sinAz = sin(uAzimuth);
    float cosEl = cos(uElevation);
    float sinEl = sin(uElevation);
    float cosRoll = cos(uRoll);
    float sinRoll = sin(uRoll);

    // Forward direction (viewing into volume)
    vec3 forward = vec3(sinAz * cosEl, -sinEl, cosAz * cosEl);
    // Right direction
    vec3 right = vec3(cosAz, 0.0, -sinAz);
    // Up direction
    vec3 up = vec3(sinAz * sinEl, cosEl, cosAz * sinEl);
    // Apply roll around world Z axis
    vec3 rightRolled = vec3(
        right.x * cosRoll - right.y * sinRoll,
        right.x * sinRoll + right.y * cosRoll,
        right.z
    );
    vec3 upRolled = vec3(
        up.x * cosRoll - up.y * sinRoll,
        up.x * sinRoll + up.y * cosRoll,
        up.z
    );
    vec3 forwardRolled = vec3(
        forward.x * cosRoll - forward.y * sinRoll,
        forward.x * sinRoll + forward.y * cosRoll,
        forward.z
    );
    right = rightRolled;
    up = upRolled;
    forward = forwardRolled;

    // Convert UV to centered coordinates [-1, 1]
    vec2 uv = (vUV - 0.5) * 2.0;

    // Apply pan offset (in normalized screen space)
    uv -= uPan;

    // Apply zoom (distance)
    uv /= uDistance;

    // Calculate aspect ratio (normalize so largest dimension = 1)
    float maxDim = max(max(uDimensions.x, uDimensions.y), uDimensions.z);
    vec3 volSize = uDimensions / maxDim;  // e.g., [1.0, 0.89, 0.22]

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
    vec3 texelSize = 1.0 / max(uDimensions, vec3(1.0));

    // Display range for windowing
    float displayRange = uDisplayMax - uDisplayMin;

    float maxValue = 0.0;

    // Low/medium quality: original march path for visual stability.
    if (uUseAdvancedRayMarch < 0.5) {
        vec3 pos = rayOrigin;
        for (int i = 0; i < 16384; i++) {
            if (i >= uNumSteps) break;
            if (all(greaterThanEqual(pos, volMin)) && all(lessThan(pos, volMax))) {
                vec3 texCoord = (pos - volMin) / volSize;
                float value;
                if (uEnableLowResAA > 0.5) {
                    value = sampleVolume8Tap(texCoord, texelSize);
                } else {
                    value = texture(uVolume, texCoord).r;
                }

                float normalized;
                if (value <= uDisplayMin || displayRange <= 0.0) {
                    normalized = 0.0;
                } else if (value >= uDisplayMax) {
                    normalized = 1.0;
                } else {
                    normalized = (value - uDisplayMin) / displayRange;
                }

                float intensity = pow(normalized, uGamma);
                maxValue = max(maxValue, intensity * intensity);
                if (maxValue >= 0.999) break;
            }
            pos += rayDir * uStepSize;
        }
        fragColor = vec4(vec3(maxValue), 1.0);
        return;
    }

    // High quality: advanced path with bounded intersection and empty-space skipping.
    vec3 raySign = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), rayDir));
    vec3 invRayDir = 1.0 / max(abs(rayDir), vec3(1e-6));
    vec3 tA = (volMin - rayOrigin) * invRayDir * raySign;
    vec3 tB = (volMax - rayOrigin) * invRayDir * raySign;
    vec3 tNear = min(tA, tB);
    vec3 tFar = max(tA, tB);
    float tEnter = max(max(tNear.x, tNear.y), tNear.z);
    float tExit = min(min(tFar.x, tFar.y), tFar.z);

    if (tExit <= max(tEnter, 0.0)) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float t = max(tEnter, 0.0);
    vec3 pos = rayOrigin + rayDir * t;
    vec3 rayDirTex = rayDir / max(volSize, vec3(1e-6));
    vec3 occDims = max(uOccupancyDims, vec3(1.0));

    for (int i = 0; i < 16384; i++) {
        if (i >= uNumSteps || t > tExit) break;

        vec3 texCoord = clamp((pos - volMin) / volSize, vec3(0.0), vec3(0.999999));
        if (uEnableEmptySpaceSkipping > 0.5) {
            ivec3 occCoord = ivec3(clamp(floor(texCoord * occDims), vec3(0.0), occDims - vec3(1.0)));
            float occMax = texelFetch(uOccupancy, occCoord, 0).r;
            if (occMax <= uSkipThreshold) {
                float skipDist = computeSkipDistance(texCoord, rayDirTex, occDims);
                float advance = max(skipDist + uSkipEpsilon, uStepSize);
                t += advance;
                pos += rayDir * advance;
                continue;
            }
        }

        float value;
        if (uEnableLowResAA > 0.5) {
            value = sampleVolume8Tap(texCoord, texelSize);
        } else {
            value = texture(uVolume, texCoord).r;
        }

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

        // Opacity-weighted MIP: use intensity as its own opacity.
        maxValue = max(maxValue, intensity * intensity);
        if (maxValue >= 0.999) break;

        // Move to next position
        t += uStepSize;
        pos += rayDir * uStepSize;
    }

    // Output MIP result
    fragColor = vec4(vec3(maxValue), 1.0);
}
`
};
