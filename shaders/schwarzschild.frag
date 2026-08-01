#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vScreen;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMotion;

uniform vec2 uResolution;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uPreviousCameraPosition;
uniform vec3 uPreviousCameraForward;
uniform vec3 uPreviousCameraRight;
uniform vec3 uPreviousCameraUp;
uniform float uTime;
uniform float uPreviousTime;
uniform float uStationRotationSpeed;
uniform vec2 uJitter;
uniform float uFovY;
uniform float uPreviousFovY;
uniform bool uMotionValid;
uniform int uMaxSteps;
uniform float uBaseStep;
uniform bool uLensing;
uniform bool uSpheresVisible;
uniform bool uSkyVisible;
uniform bool uRingsVisible;
uniform int uShellCount;
uniform float uExposure;
uniform float uSaturation;
uniform sampler2D uSky;
uniform sampler2D uPhotonLabel;
uniform float uPhotonLabelOpacity;

const float PI = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;
const float M = 1.0;
const float CAPTURE_RHO = 0.515;
const float PHOTON_RHO = 1.8660254037844386;
const int STATION_ASSEMBLY_COUNT = 3;
const float STATION_DOUBLE_BAND_LATITUDE = 0.1875;
const float STATION_ENVELOPE_HALF_ANGLE = 0.15;
const float STATION_RADIAL_ENVELOPE = 0.11;
const float STATION_OUTER_RHO = PHOTON_RHO + 0.30;
const float STATION_INNER_RHO = PHOTON_RHO - 0.30;
const float CRITICAL_IMPACT = 5.196152422706632;
const float ESCAPE_RHO = 36.0;
const int HARD_MAX_STEPS = 896;
const int SHELL_COUNT = 8;

bool stationMotionHit;
vec3 stationMotionPoint;
float stationMotionDepth;
int stationMotionAssemblyIndex;
bool staticMotionHit;
vec3 staticMotionPoint;
float staticMotionDepth;
bool horizonMotionHit;
vec3 horizonMotionPoint;

const float SHELL_RADII[SHELL_COUNT] = float[](
    0.93166248, 1.30901699, 1.86602540, 2.39564392,
    2.91421356, 3.93649167, 5.45416346, 6.96410162
);

float saturate(float value) {
    return clamp(value, 0.0, 1.0);
}

float stationAssemblyRadius(int assemblyIndex) {
    if (assemblyIndex == 1) return STATION_OUTER_RHO;
    if (assemblyIndex == 2) return STATION_INNER_RHO;
    return PHOTON_RHO;
}

vec3 stationWorldToAssembly(vec3 point, int assemblyIndex) {
    return point;
}

vec3 stationAssemblyToWorld(vec3 point, int assemblyIndex) {
    return point;
}

float stationAssemblyBandEnvelope(vec3 point, int assemblyIndex) {
    vec3 localPoint = stationWorldToAssembly(point, assemblyIndex);
    float stationRadius = length(localPoint);
    float stationLatitude = asin(
        clamp(
            abs(localPoint.y) / max(stationRadius, 1e-8),
            0.0,
            1.0
        )
    );
    float angularEnvelope =
        stationRadius
        * sin(
            abs(
                stationLatitude
                - STATION_DOUBLE_BAND_LATITUDE
            )
            - STATION_ENVELOPE_HALF_ANGLE
        );
    float radialEnvelope =
        abs(
            stationRadius
            - stationAssemblyRadius(assemblyIndex)
        )
        - STATION_RADIAL_ENVELOPE;
    return max(radialEnvelope, angularEnvelope);
}

float stationBandEnvelope(vec3 point) {
    float envelope = 1e20;
    for (
        int assemblyIndex = 0;
        assemblyIndex < STATION_ASSEMBLY_COUNT;
        ++assemblyIndex
    ) {
        envelope = min(
            envelope,
            stationAssemblyBandEnvelope(point, assemblyIndex)
        );
    }
    return envelope;
}

float opticalIndex(float rho) {
    float a = M / (2.0 * rho);
    return ((1.0 + a) * (1.0 + a) * (1.0 + a)) / (1.0 - a);
}

vec3 shellColor(int index) {
    if (index < 2) return vec3(1.00, 0.12, 0.58);
    if (index == 2) return vec3(1.00, 0.72, 0.08);
    return vec3(0.08, 0.84, 1.00);
}

vec3 opticalAcceleration(vec3 position, vec3 tangent) {
    float rho = length(position);
    if (rho <= CAPTURE_RHO) return vec3(0.0);

    float a = M / (2.0 * rho);
    float denominator = max(1.0 - a, 1e-5);
    float dLogNdr = -(a / rho) * (3.0 / (1.0 + a) + 1.0 / denominator);
    vec3 gradient = position * (dLogNdr / rho);
    return gradient - tangent * dot(tangent, gradient);
}

float adaptiveStep(vec3 point) {
    float rho = length(point);
    float interpolation = smoothstep(1.2, 18.0, rho);
    float rayStep = uBaseStep * mix(0.35, 6.0, interpolation);

    // The unstable photon orbit needs a stricter cap than ordinary shell events.
    float photonBlend = smoothstep(0.0, 0.28, abs(rho - PHOTON_RHO));
    rayStep = min(rayStep, mix(0.016, rayStep, photonBlend));

    // Only enabled material shells incur crossing refinement.
    if (uSpheresVisible && rho > 0.64 && rho < 7.30) {
        for (int shell = 0; shell < SHELL_COUNT; ++shell) {
            if (shell >= uShellCount) break;
            float distanceToShell = abs(rho - SHELL_RADII[shell]);
            float shellBlend = smoothstep(0.0, 0.28, distanceToShell);
            rayStep = min(rayStep, mix(0.075, rayStep, shellBlend));
        }
    }

    // Refine around the three coplanar doublets at their nested radii.
    if (uRingsVisible) {
        float stationEnvelope = stationBandEnvelope(point);
        float stationBlend =
            smoothstep(0.025, 0.20, max(stationEnvelope, 0.0));
        rayStep = min(rayStep, mix(0.010, rayStep, stationBlend));
    }
    return rayStep;
}

void accumulatePhotonLabelHit(
    vec3 crossing,
    vec3 rayDirection,
    float coverage,
    inout vec3 overlayLight,
    inout float overlayOpacity
) {
    if (uPhotonLabelOpacity <= 0.001) return;

    vec3 normal = normalize(crossing);
    float latitude = asin(clamp(normal.y, -1.0, 1.0));
    const float labelHalfLatitude = 0.16;
    if (abs(latitude) >= labelHalfLatitude) return;

    float longitude = atan(normal.z, normal.x);
    float wrappedLongitude =
        fract(longitude / TAU + 0.25);
    bool cameraInsidePhotonSphere =
        length(uCameraPosition) < PHOTON_RHO;
    float readableLongitude =
        cameraInsidePhotonSphere
        ? wrappedLongitude
        : 1.0 - wrappedLongitude;
    vec2 labelUv = vec2(
        readableLongitude,
        latitude / (2.0 * labelHalfLatitude) + 0.5
    );
    float cameraDistance =
        length(crossing - uCameraPosition);
    float pixelWorld =
        2.0
        * cameraDistance
        * tan(0.5 * uFovY)
        / max(uResolution.y, 1.0);
    float viewFacing =
        max(
            abs(dot(normal, normalize(-rayDirection))),
            0.12
        );
    float texelFootprint =
        pixelWorld
        * 800.0
        / (PHOTON_RHO * viewFacing);
    float labelLod =
        clamp(log2(max(texelFootprint, 1.0)), 0.0, 8.0);
    float glyph =
        smoothstep(
            0.04,
            0.78,
            textureLod(uPhotonLabel, labelUv, labelLod).a
        );
    float photonProximityFade =
        smoothstep(
            0.22,
            0.95,
            abs(length(uCameraPosition) - PHOTON_RHO)
        );
    float alpha =
        glyph
        * coverage
        * uPhotonLabelOpacity
        * photonProximityFade
        * 0.72;
    if (alpha <= 0.001) return;

    if (!staticMotionHit) {
        staticMotionHit = true;
        staticMotionPoint = crossing;
        staticMotionDepth = cameraDistance;
    }
    vec3 emission = vec3(1.0, 0.70, 0.055) * 1.75;
    overlayLight += (1.0 - overlayOpacity) * alpha * emission;
    overlayOpacity += (1.0 - overlayOpacity) * alpha * 0.58;
}

float surfaceGrain(vec3 point, int shell) {
    vec3 samplePoint = point * (7.0 + float(shell) * 0.83);
    float first = sin(dot(samplePoint, vec3(1.37, 2.11, 2.83)));
    float second = sin(dot(samplePoint, vec3(-3.17, 1.29, 0.73)) + 2.4);
    float third = sin(dot(samplePoint, vec3(0.61, -2.53, 3.41)) - 1.7);
    return 0.5 + 0.1666667 * (first + second + third);
}

void accumulateSphereHit(
    vec3 crossing,
    vec3 rayDirection,
    int shell,
    float coverage,
    inout vec3 surfaceLight,
    inout float surfaceOpacity
) {
    if (!uSpheresVisible) return;
    if (
        !staticMotionHit
        && coverage > 0.001
        && surfaceOpacity < 0.999
    ) {
        staticMotionHit = true;
        staticMotionPoint = crossing;
        staticMotionDepth =
            length(crossing - uCameraPosition);
    }

    vec3 normal = normalize(crossing);
    vec3 viewDirection = normalize(-rayDirection);
    float faceSign = dot(normal, viewDirection) >= 0.0 ? 1.0 : -1.0;
    vec3 facingNormal = normal * faceSign;
    float latitude = asin(clamp(normal.y, -1.0, 1.0));
    float longitude = atan(normal.z, normal.x);

    // Long brushed arcs, fine cross-grain, and a shallow procedural normal
    // make every shell feel hand-finished without an external texture map.
    float flowPhase =
        longitude * (5.0 + float(shell))
        + latitude * 8.0
        + sin(latitude * 3.0) * 1.8
        + float(shell) * 1.71;
    float directionalFlow = 0.5 + 0.5 * sin(flowPhase);
    float crossGrain =
        0.5
        + 0.5
        * sin(longitude * 37.0 - latitude * 23.0 + float(shell) * 2.17);
    float grain = surfaceGrain(normal * SHELL_RADII[shell], shell);
    float brushedTexture =
        clamp(0.70 + 0.16 * directionalFlow + 0.05 * crossGrain + 0.09 * grain, 0.54, 1.02);

    vec3 longitudeTangentRaw = vec3(-normal.z, 0.0, normal.x);
    float longitudeTangentLength = length(longitudeTangentRaw);
    vec3 longitudeTangent =
        longitudeTangentLength > 0.001
        ? longitudeTangentRaw / longitudeTangentLength
        : vec3(1.0, 0.0, 0.0);
    vec3 latitudeTangent = normalize(cross(longitudeTangent, normal));
    vec3 detailNormal = normalize(
        facingNormal
        + longitudeTangent * cos(flowPhase) * 0.11
        + latitudeTangent
          * cos(longitude * 37.0 - latitude * 23.0 + float(shell) * 2.17)
          * 0.035
    );

    vec3 keyLight = normalize(vec3(-0.42, 0.72, 0.55));
    vec3 fillLight = normalize(vec3(0.68, -0.18, -0.72));
    float diffuse = max(dot(detailNormal, keyLight), 0.0);
    float fill = max(dot(detailNormal, fillLight), 0.0);
    float viewFacing = abs(dot(normal, viewDirection));
    float rim = pow(1.0 - viewFacing, 2.4);
    vec3 halfVector = normalize(keyLight + viewDirection);
    float specular = pow(max(dot(detailNormal, halfVector), 0.0), 34.0);
    float brushedGlint =
        pow(max(0.0, cos(flowPhase)), 18.0)
        * (0.35 + 0.65 * diffuse);

    vec3 baseColor = shellColor(shell);
    vec3 material =
        baseColor
        * brushedTexture
        * (0.035 + 0.18 * diffuse + 0.055 * fill)
        + baseColor * rim * 0.10
        + vec3(1.0, 0.94, 0.82)
          * (0.075 * specular + 0.026 * brushedGlint);

    // Every hit is fully opaque. Flipping facingNormal above gives the inner
    // and outer faces the same complete material treatment.
    float alpha = saturate(coverage);
    surfaceLight += (1.0 - surfaceOpacity) * alpha * material;
    surfaceOpacity += (1.0 - surfaceOpacity) * alpha;
}

bool segmentSphereRoots(
    vec3 start,
    vec3 segment,
    float radius,
    out float firstRoot,
    out float secondRoot
) {
    float quadraticA = dot(segment, segment);
    if (quadraticA <= 1e-12) {
        firstRoot = 2.0;
        secondRoot = 2.0;
        return false;
    }

    float quadraticB = 2.0 * dot(start, segment);
    float quadraticC = dot(start, start) - radius * radius;
    float discriminant =
        quadraticB * quadraticB - 4.0 * quadraticA * quadraticC;
    if (discriminant < 0.0) {
        firstRoot = 2.0;
        secondRoot = 2.0;
        return false;
    }

    float root = sqrt(max(discriminant, 0.0));
    float inverseDenominator = 0.5 / quadraticA;
    firstRoot = (-quadraticB - root) * inverseDenominator;
    secondRoot = (-quadraticB + root) * inverseDenominator;
    return true;
}

bool opaqueSphereBeforeEvent(
    vec3 start,
    vec3 end,
    float eventT
) {
    if (!uSpheresVisible) return false;
    vec3 segment = end - start;
    for (int shell = 0; shell < SHELL_COUNT; ++shell) {
        if (shell >= uShellCount) break;
        float firstRoot;
        float secondRoot;
        if (
            segmentSphereRoots(
                start,
                segment,
                SHELL_RADII[shell],
                firstRoot,
                secondRoot
            )
        ) {
            if (firstRoot > 1e-5 && firstRoot < eventT - 1e-5) return true;
            if (secondRoot > 1e-5 && secondRoot < eventT - 1e-5) return true;
        }
    }
    return false;
}

/*__ORBITAL_STATION_GLSL__*/


float stationEnvelopeDistance(vec3 point) {
    return stationBandEnvelope(point);
}

float dysonScene(vec3 point) {
    float envelopeDistance = stationEnvelopeDistance(point);
    if (envelopeDistance > 0.06) return envelopeDistance;
    return stationDistanceOnly(point);
}

float stationPixelFootprint(vec3 point) {
    return max(
        2.0
        * length(point - uCameraPosition)
        * tan(0.5 * uFovY)
        / max(uResolution.y, 1.0),
        1e-6
    );
}

float stationHitEpsilon(float pixelFootprint) {
    return clamp(
        pixelFootprint * 0.08,
        0.00012,
        0.0012
    );
}

void refineDysonHitAlongRay(
    vec3 rayOrigin,
    vec3 rayDirection,
    float maximumTravel,
    float initialTravel,
    float initialDistance,
    float hitEpsilon,
    out vec3 refinedPoint,
    out float refinedDistance,
    out float refinedTravel
) {
    float travel =
        clamp(initialTravel, 0.0, maximumTravel);
    float sceneDistance = initialDistance;
    float bestTravel = travel;
    float bestDistance = sceneDistance;
    float bestAbsoluteDistance = abs(sceneDistance);
    float outsideTravel = travel;
    float insideTravel = travel;
    bool hasOutside = sceneDistance >= 0.0;
    bool hasInside = sceneDistance < 0.0;

    for (int refinementStep = 0; refinementStep < 6; ++refinementStep) {
        if (bestAbsoluteDistance <= hitEpsilon * 0.04) break;

        float candidateTravel;
        if (hasOutside && hasInside) {
            candidateTravel =
                0.5 * (outsideTravel + insideTravel);
        } else {
            float refinementAdvance =
                clamp(
                    max(
                        abs(sceneDistance) * 0.75,
                        hitEpsilon * 0.12
                    ),
                    hitEpsilon * 0.12,
                    hitEpsilon * 1.5
                );
            float refinementDirection =
                hasInside && !hasOutside ? -1.0 : 1.0;
            candidateTravel =
                clamp(
                    travel
                        + refinementDirection
                        * refinementAdvance,
                    0.0,
                    maximumTravel
                );
        }
        if (abs(candidateTravel - travel) <= 1e-7) break;

        vec3 candidatePoint =
            rayOrigin + rayDirection * candidateTravel;
        float candidateDistance =
            dysonScene(candidatePoint);
        float candidateAbsoluteDistance =
            abs(candidateDistance);
        if (candidateAbsoluteDistance < bestAbsoluteDistance) {
            bestAbsoluteDistance = candidateAbsoluteDistance;
            bestDistance = candidateDistance;
            bestTravel = candidateTravel;
        }

        if (candidateDistance >= 0.0) {
            outsideTravel = candidateTravel;
            hasOutside = true;
        } else {
            insideTravel = candidateTravel;
            hasInside = true;
        }
        travel = candidateTravel;
        sceneDistance = candidateDistance;
    }

    refinedTravel = bestTravel;
    refinedDistance = bestDistance;
    refinedPoint =
        rayOrigin + rayDirection * bestTravel;
}

vec3 dysonNormal(vec3 point, float epsilon) {
    const vec2 tetra = vec2(1.0, -1.0);
    vec3 normalValue = vec3(0.0);
    float sampleDistance;
    uint ignoredMaterial;

    stationScene(
        point + tetra.xyy * epsilon,
        sampleDistance,
        ignoredMaterial
    );
    normalValue += tetra.xyy * sampleDistance;
    stationScene(
        point + tetra.yyx * epsilon,
        sampleDistance,
        ignoredMaterial
    );
    normalValue += tetra.yyx * sampleDistance;
    stationScene(
        point + tetra.yxy * epsilon,
        sampleDistance,
        ignoredMaterial
    );
    normalValue += tetra.yxy * sampleDistance;
    stationScene(
        point + tetra.xxx * epsilon,
        sampleDistance,
        ignoredMaterial
    );
    normalValue += tetra.xxx * sampleDistance;
    return normalValue / max(length(normalValue), 1e-8);
}

float stationAmbientOcclusion(
    vec3 point,
    vec3 normal,
    float pixelFootprint
) {
    float sourceOffset =
        max(
            0.0125,
            0.18 * pixelFootprint / STATION_SCALE
        );
    float sampleWeight = 1.0;
    float weightedOcclusion = 0.0;
    float totalWeight = 0.0;
    for (int sampleIndex = 0; sampleIndex < 4; ++sampleIndex) {
        float worldDistance;
        uint ignoredMaterial;
        stationScene(
            point + normal * (sourceOffset * STATION_SCALE),
            worldDistance,
            ignoredMaterial
        );
        float sourceDistance =
            worldDistance / STATION_SCALE;
        weightedOcclusion +=
            sampleWeight
            * saturate(
                (sourceOffset - sourceDistance)
                / max(sourceOffset, 1e-4)
            );
        totalWeight += sampleWeight;
        sourceOffset *= 1.85;
        sampleWeight *= 0.55;
    }
    return clamp(
        1.0
            - 1.35
            * weightedOcclusion
            / max(totalWeight, 1e-4),
        0.15,
        1.0
    );
}

float stationSunShadow(
    vec3 point,
    vec3 normal,
    vec3 sunDirection,
    float pixelFootprint
) {
    float sourceEpsilon =
        clamp(
            0.18 * pixelFootprint / STATION_SCALE,
            0.0015,
            0.018
        );
    float shadow = 1.0;
    float sourceTravel =
        max(0.012, sourceEpsilon * 1.5);
    vec3 sourceOrigin =
        point / STATION_SCALE
        + normal * max(0.006, sourceEpsilon * 1.5);

    for (int shadowStep = 0; shadowStep < 28; ++shadowStep) {
        vec3 sourceSample =
            sourceOrigin + sunDirection * sourceTravel;
        float worldDistance;
        uint ignoredMaterial;
        stationScene(
            sourceSample * STATION_SCALE,
            worldDistance,
            ignoredMaterial
        );
        float sourceDistance = worldDistance / STATION_SCALE;
        if (sourceDistance <= sourceEpsilon) return 0.0;
        shadow =
            min(
                shadow,
                8.0
                * sourceDistance
                / max(sourceTravel, sourceEpsilon)
            );
        float sourceAdvance =
            clamp(
                sourceDistance * 0.65,
                max(0.006, sourceEpsilon * 0.5),
                0.22
            );
        sourceTravel += sourceAdvance;
        if (sourceTravel > 4.5) break;
    }
    return smoothstep(0.08, 0.92, saturate(shadow));
}

vec3 stationEnvironment(vec3 direction, float lod) {
    vec3 ray = normalize(direction);
    vec2 uv = vec2(
        atan(ray.z, ray.x) / TAU + 0.5,
        asin(clamp(ray.y, -1.0, 1.0)) / PI + 0.5
    );
    return textureLod(uSky, uv, lod).rgb;
}

float stationPeriodicLineAA(
    float coordinate,
    float halfWidth,
    float coordinateFootprint
) {
    float distanceToLine =
        abs(fract(coordinate + 0.5) - 0.5);
    float filterWidth =
        max(coordinateFootprint * 0.75, 1e-4);
    return
        1.0
        - smoothstep(
            halfWidth - filterWidth,
            halfWidth + filterWidth,
            distanceToLine
        );
}

float stationPeriodicBandAA(
    float coordinate,
    float innerHalfWidth,
    float outerHalfWidth,
    float coordinateFootprint
) {
    float distanceToCenter =
        abs(fract(coordinate) - 0.5);
    float filterWidth =
        max(coordinateFootprint * 0.75, 1e-4);
    return smoothstep(
        innerHalfWidth - filterWidth,
        outerHalfWidth + filterWidth,
        distanceToCenter
    );
}

vec3 stationSurfaceMaterial(
    uint materialId,
    vec3 worldPoint,
    vec3 normal,
    vec3 rayDirection,
    float ambient,
    float sunShadow,
    float pixelFootprint
) {
    // Keep the procedural panels, windows, and noise locked to the same
    // rotating object-space point used by the station distance field.
    vec3 worldSourcePoint = worldPoint / STATION_SCALE;
    int assemblyIndex =
        stationClosestAssemblyIndex(worldSourcePoint);
    vec3 sourcePoint = stationAssemblyRotatingSourcePoint(
        worldSourcePoint,
        assemblyIndex,
        uTime
    );
    vec3 sourceNormal = stationAssemblyRotatingDirection(
        normal,
        assemblyIndex,
        uTime
    );
    float sourcePixelFootprint =
        max(pixelFootprint / STATION_SCALE, 1e-5);
    vec3 sunDirection = normalize(vec3(0.93, 1.0, 1.0));
    const vec3 sunColor = vec3(2.58, 2.38, 2.10) * 0.8;
    const vec3 skyColor = vec3(0.3, 0.45, 0.8) * 0.5;
    vec3 ambientDirection =
        normalize(vec3(-6500.0, -6400.0, -3400.0));

    float specular = 0.0;
    vec3 textureColor = vec3(0.5);
    if (materialId == STATION_MAT_WALL) {
        textureColor = vec3(0.5, 0.6, 0.7);
    } else if (materialId == STATION_MAT_PIPE) {
        textureColor = vec3(0.15, 0.12, 0.10) * 0.5;
    } else if (materialId == STATION_MAT_CHROME) {
        textureColor = vec3(0.01);
        specular = 1.0;
    } else if (materialId == STATION_MAT_GLOSSY_ROUGH) {
        textureColor = vec3(0.5);
        specular = 0.99;
    } else if (materialId == STATION_MAT_YELLOW) {
        textureColor = vec3(0.6, 0.42, 0.05) * 0.755;
        specular = 0.1;
    } else if (materialId == STATION_MAT_SIDE_WINDOWS) {
        vec3 cylindrical = stationBandTransform(
            sourcePoint,
            assemblyIndex
        );
        float grid =
            max(
                stationPeriodicLineAA(
                    cylindrical.x * 16.0,
                    0.05,
                    sourcePixelFootprint * 16.0
                ),
                stationPeriodicLineAA(
                    cylindrical.z * 32.0,
                    0.05,
                    sourcePixelFootprint * 32.0
                )
            );
        textureColor = vec3(0.5, 0.7, 1.0) * grid;
        specular = 0.2;
    } else if (materialId == STATION_MAT_FLOOR) {
        vec3 cylindrical = stationBandTransform(
            sourcePoint,
            assemblyIndex
        );
        vec3 panelNormal;
        cylindrical.xy *= vec2(16.0, 4.0);
        float panelFootprint =
            sourcePixelFootprint * 38.4;
        vec4 panel =
            stationTexPanelsDense(
                cylindrical.xy * 8.0 * vec2(0.2, 1.2),
                panelFootprint,
                panelNormal
            );
        textureColor = vec3(0.0, 0.02, 0.05);
        textureColor += panel.aaa * 7.0 - 0.39;
        textureColor *= vec3(0.96, 0.98, 0.97);
        specular = panel.w * 0.1;
        if (abs(sourceNormal.y) > 0.9) {
            textureColor = vec3(0.4);
        }
    } else if (materialId == STATION_MAT_DOME) {
        vec3 cylindrical = stationBandTransform(
            sourcePoint,
            assemblyIndex
        );
        textureColor *= vec3(0.91, 0.97, 0.998) * 0.8;
        float windows =
            stationPeriodicBandAA(
                cylindrical.z * 64.0,
                0.25,
                0.3125,
                sourcePixelFootprint * 64.0
            );
        specular = windows * 0.2;
        textureColor *= windows * 0.35 + 0.65;
    } else if (stationIsMatRgb(materialId)) {
        textureColor =
            stationGetMatRgb(materialId) * (1.0 / 255.0);
    }

    float sourceNoise = 0.0;
    vec3 noisePoint = sourcePoint;
    noisePoint.y = abs(noisePoint.y);
    float baseNoiseFootprint =
        sourcePixelFootprint * 8.0;
    float doubler = 1.0;
    for (int octave = 0; octave < 4; ++octave) {
        float octaveFootprint =
            baseNoiseFootprint * doubler;
        float octaveCoverage =
            1.0
            - smoothstep(0.35, 1.0, octaveFootprint);
        float octaveNoise =
            mix(
                0.5,
                stationNoise(noisePoint * 8.0 * doubler),
                octaveCoverage
            );
        sourceNoise +=
            octaveNoise / doubler;
        doubler *= 2.0;
    }
    textureColor *= sourceNoise * 0.25 + 0.75;
    if (materialId == STATION_MAT_SPOKE) {
        textureColor = vec3(0.6);
    }

    vec3 lightColor =
        sunColor
        * saturate(dot(sunDirection, normal))
        * sunShadow;
    lightColor +=
        skyColor
        * saturate(
            dot(normal, ambientDirection) * 0.5 + 0.5
        )
        * pow(ambient, 0.25);

    if (materialId == STATION_MAT_FLOOR) {
        float emissiveNoise = saturate(sourceNoise - 0.5);
        float windows =
            1.0
            - stationPeriodicBandAA(
                sourcePoint.y * 16.0,
                0.9 / 14.0,
                1.9 / 14.0,
                sourcePixelFootprint * 16.0
            );
        if (textureColor.x < 0.0001) {
            textureColor = vec3(0.4) * windows;
            lightColor +=
                vec3(0.99, 0.8, 0.35)
                * 2.0
                * emissiveNoise;
        }
    }

    vec3 reflection = reflect(rayDirection, normalize(normal));
    vec3 environmentColor;
    if (materialId == STATION_MAT_GLOSSY_ROUGH) {
        float sunReflection =
            pow(
                max(dot(reflection, sunDirection), 0.0),
                7.0
            );
        float ambientReflection =
            pow(
                dot(reflection, ambientDirection) * 0.5 + 0.5,
                3.0
            ) * 0.6;
        environmentColor =
            sunColor * sunReflection * sunShadow
            + vec3(70.0, 130.0, 240.0)
                * (1.0 / 355.0)
                * ambientReflection;
    } else {
        environmentColor =
            stationEnvironment(reflection, 1.5);
    }

    vec3 litColor = textureColor * lightColor;
    litColor = mix(litColor, environmentColor, specular);
    return mix(litColor, vec3(0.07, 0.13, 0.2), 0.08);
}

bool accumulateDysonHit(
    vec3 hitPoint,
    vec3 rayDirection,
    float sceneDistance,
    float hitEpsilon,
    float pixelFootprint,
    inout vec3 structureLight,
    inout float structureOpacity
) {
    if (sceneDistance > hitEpsilon) return false;

    float exactDistance;
    uint materialId;
    stationScene(hitPoint, exactDistance, materialId);

    float normalEpsilon =
        clamp(
            pixelFootprint * 0.08,
            0.00045 * STATION_SCALE,
            0.0035 * STATION_SCALE
        );
    vec3 normal =
        dysonNormal(hitPoint, normalEpsilon);
    vec3 surfacePoint =
        hitPoint
        - normal
        * clamp(
            exactDistance,
            -hitEpsilon,
            hitEpsilon
        );
    stationScene(surfacePoint, exactDistance, materialId);
    vec3 viewDirection = normalize(-rayDirection);
    if (dot(normal, viewDirection) < 0.0) normal = -normal;

    float ambientOcclusion =
        stationAmbientOcclusion(
            surfacePoint,
            normal,
            pixelFootprint
        );
    vec3 sunDirection = normalize(vec3(0.93, 1.0, 1.0));
    float sunShadow =
        stationSunShadow(
            surfacePoint,
            normal,
            sunDirection,
            pixelFootprint
        );
    vec3 material =
        stationSurfaceMaterial(
            materialId,
            surfacePoint,
            normal,
            rayDirection,
            ambientOcclusion,
            sunShadow,
            pixelFootprint
        );

    stationMotionHit = true;
    stationMotionPoint = surfacePoint;
    stationMotionDepth =
        length(surfacePoint - uCameraPosition);
    stationMotionAssemblyIndex = stationClosestAssemblyIndex(
        surfacePoint / STATION_SCALE
    );
    structureLight +=
        (1.0 - structureOpacity) * material;
    structureOpacity = 1.0;
    return true;
}

void accumulateDysonSegment(
    vec3 oldPosition,
    vec3 newPosition,
    vec3 rayDirection,
    float sphereOpacity,
    out float hitT,
    inout vec3 structureLight,
    inout float structureOpacity
) {
    hitT = 2.0;
    if (
        !uRingsVisible
        || structureOpacity >= 0.999
        || sphereOpacity >= 0.999
    ) return;

    vec3 segment = newPosition - oldPosition;
    float segmentLength = length(segment);
    if (segmentLength <= 1e-8) return;
    vec3 segmentDirection = segment / segmentLength;

    vec3 midpoint = 0.5 * (oldPosition + newPosition);
    float envelopeMargin = 0.5 * segmentLength + 0.07;
    if (stationEnvelopeDistance(midpoint) > envelopeMargin) return;

    float rayT = 0.0;
    for (int probe = 0; probe < 12; ++probe) {
        if (rayT > 1.0) break;
        vec3 samplePoint = oldPosition + segment * rayT;
        float sceneDistance = dysonScene(samplePoint);
        float pixelFootprint =
            stationPixelFootprint(samplePoint);
        float hitEpsilon =
            stationHitEpsilon(pixelFootprint);
        if (sceneDistance <= hitEpsilon) {
            vec3 refinedPoint;
            float refinedDistance;
            float refinedTravel;
            refineDysonHitAlongRay(
                oldPosition,
                segmentDirection,
                segmentLength,
                rayT * segmentLength,
                sceneDistance,
                hitEpsilon,
                refinedPoint,
                refinedDistance,
                refinedTravel
            );
            float refinedT =
                refinedTravel / segmentLength;
            pixelFootprint =
                stationPixelFootprint(refinedPoint);
            if (
                opaqueSphereBeforeEvent(
                    oldPosition,
                    newPosition,
                    refinedT
                )
            ) return;
            if (
                accumulateDysonHit(
                    refinedPoint,
                    rayDirection,
                    refinedDistance,
                    hitEpsilon,
                    pixelFootprint,
                    structureLight,
                    structureOpacity
                )
            ) {
                hitT = refinedT;
                return;
            }
        }
        float advance =
            clamp(
                max(sceneDistance - hitEpsilon, 0.0)
                    * 0.65
                    / segmentLength,
                0.085,
                0.24
            );
        rayT += advance;
    }
}

void traceFlatDyson(
    vec3 origin,
    vec3 tangent,
    float maximumDistance,
    out float hitDistance,
    inout vec3 structureLight,
    inout float structureOpacity
) {
    hitDistance = 1e20;
    if (!uRingsVisible) return;

    const float boundRadius = 2.42;
    float projection = dot(origin, tangent);
    float discriminant =
        projection * projection
        - (dot(origin, origin) - boundRadius * boundRadius);
    if (discriminant < 0.0) return;

    float root = sqrt(discriminant);
    float travel = max(0.0, -projection - root);
    float travelEnd =
        min(maximumDistance, -projection + root);
    if (travel > travelEnd) return;

    for (int probe = 0; probe < 192; ++probe) {
        if (travel > travelEnd) break;
        vec3 samplePoint = origin + tangent * travel;
        float sceneDistance = dysonScene(samplePoint);
        float pixelFootprint =
            stationPixelFootprint(samplePoint);
        float hitEpsilon =
            stationHitEpsilon(pixelFootprint);
        if (sceneDistance <= hitEpsilon) {
            vec3 refinedPoint;
            float refinedDistance;
            float refinedTravel;
            refineDysonHitAlongRay(
                origin,
                tangent,
                travelEnd,
                travel,
                sceneDistance,
                hitEpsilon,
                refinedPoint,
                refinedDistance,
                refinedTravel
            );
            pixelFootprint =
                stationPixelFootprint(refinedPoint);
            if (
                opaqueSphereBeforeEvent(
                    origin,
                    refinedPoint,
                    1.0
                )
            ) return;
            if (
                accumulateDysonHit(
                    refinedPoint,
                    tangent,
                    refinedDistance,
                    hitEpsilon,
                    pixelFootprint,
                    structureLight,
                    structureOpacity
                )
            ) {
                hitDistance = refinedTravel;
                return;
            }
        }
        float advance = max(sceneDistance * 0.65, 0.0008);
        if (stationEnvelopeDistance(samplePoint) < 0.10) {
            advance = min(advance, 0.012);
        }
        travel += advance;
    }
}

void accumulateShellCrossings(
    vec3 oldPosition,
    vec3 newPosition,
    vec3 rayDirection,
    inout vec3 overlayLight,
    inout float overlayOpacity,
    inout vec3 surfaceLight,
    inout float surfaceOpacity,
    float structureT
) {
    bool labelActive = uPhotonLabelOpacity > 0.001;
    if (!uSpheresVisible && !labelActive) return;

    vec3 segment = newPosition - oldPosition;
    float segmentLengthSquared = dot(segment, segment);
    if (segmentLengthSquared < 1e-12) return;

    for (int shell = 0; shell < SHELL_COUNT; ++shell) {
        bool shellEnabled = uSpheresVisible && shell < uShellCount;
        bool photonLabelShell = labelActive && shell == 2;
        if (!shellEnabled && !photonLabelShell) continue;
        float shellRadius = SHELL_RADII[shell];
        float firstRoot;
        float secondRoot;
        bool intersects =
            segmentSphereRoots(
                oldPosition,
                segment,
                shellRadius,
                firstRoot,
                secondRoot
            );

        if (intersects) {
            if (firstRoot > 1e-5 && firstRoot <= 1.0 + 1e-5) {
                vec3 crossing =
                    oldPosition + segment * clamp(firstRoot, 0.0, 1.0);
                if (
                    photonLabelShell
                    && surfaceOpacity < 0.999
                    && firstRoot < structureT
                ) {
                    accumulatePhotonLabelHit(
                        crossing,
                        rayDirection,
                        1.0,
                        overlayLight,
                        overlayOpacity
                    );
                }
                if (shellEnabled) {
                    accumulateSphereHit(
                        crossing,
                        rayDirection,
                        shell,
                        1.0,
                        surfaceLight,
                        surfaceOpacity
                    );
                }
            }
            if (
                secondRoot > 1e-5
                && secondRoot <= 1.0 + 1e-5
                && abs(secondRoot - firstRoot) > 1e-5
            ) {
                vec3 crossing =
                    oldPosition + segment * clamp(secondRoot, 0.0, 1.0);
                if (
                    photonLabelShell
                    && surfaceOpacity < 0.999
                    && secondRoot < structureT
                ) {
                    accumulatePhotonLabelHit(
                        crossing,
                        rayDirection,
                        1.0,
                        overlayLight,
                        overlayOpacity
                    );
                }
                if (shellEnabled) {
                    accumulateSphereHit(
                        crossing,
                        rayDirection,
                        shell,
                        1.0,
                        surfaceLight,
                        surfaceOpacity
                    );
                }
            }
            continue;
        }

        // A one-pixel coverage fringe anti-aliases the exact tangent without
        // making the material translucent away from its geometric silhouette.
        float closestT =
            clamp(
                -dot(oldPosition, segment) / segmentLengthSquared,
                0.0,
                1.0
            );
        if (closestT <= 1e-4 || closestT >= 1.0 - 1e-4) continue;
        vec3 closestPoint = oldPosition + segment * closestT;
        float missDistance = length(closestPoint) - shellRadius;
        if (missDistance < 0.0) continue;
        float pixelWorld =
            max(
                0.00035,
                2.0
                * length(closestPoint - uCameraPosition)
                * tan(0.5 * uFovY)
                / max(uResolution.y, 1.0)
            );
        float edgeCoverage =
            1.0 - smoothstep(0.0, pixelWorld * 1.25, missDistance);
        if (edgeCoverage <= 0.001) continue;
        if (
            photonLabelShell
            && surfaceOpacity < 0.999
            && closestT < structureT
        ) {
            accumulatePhotonLabelHit(
                closestPoint,
                rayDirection,
                edgeCoverage,
                overlayLight,
                overlayOpacity
            );
        }
        if (shellEnabled) {
            accumulateSphereHit(
                closestPoint,
                rayDirection,
                shell,
                edgeCoverage,
                surfaceLight,
                surfaceOpacity
            );
        }
    }
}

void traceFlatScene(
    vec3 origin,
    vec3 tangent,
    inout vec3 overlayLight,
    inout float overlayOpacity,
    inout vec3 surfaceLight,
    inout float surfaceOpacity,
    inout vec3 structureLight,
    inout float structureOpacity,
    out bool captured
) {
    float originProjection = dot(origin, tangent);
    float horizonDiscriminant =
        originProjection * originProjection - (dot(origin, origin) - CAPTURE_RHO * CAPTURE_RHO);
    float horizonDistance = 1e20;
    captured = false;

    if (horizonDiscriminant >= 0.0) {
        float nearHorizon = -originProjection - sqrt(horizonDiscriminant);
        if (nearHorizon > 0.0) {
            captured = true;
            horizonDistance = nearHorizon;
            horizonMotionHit = true;
            horizonMotionPoint =
                origin + tangent * nearHorizon;
        }
    }

    float structureDistance;
    traceFlatDyson(
        origin,
        tangent,
        horizonDistance,
        structureDistance,
        structureLight,
        structureOpacity
    );

    bool spheresActive = uSpheresVisible;
    bool labelActive = uPhotonLabelOpacity > 0.001;
    if (spheresActive || labelActive) {
        // Outside-to-inside near hits are the correct front-to-back order.
        for (int shell = SHELL_COUNT - 1; shell >= 0; --shell) {
            bool shellEnabled = spheresActive && shell < uShellCount;
            bool photonLabelShell = labelActive && shell == 2;
            if (!shellEnabled && !photonLabelShell) continue;
            float radius = SHELL_RADII[shell];
            float discriminant =
                originProjection * originProjection - (dot(origin, origin) - radius * radius);
            if (discriminant < 0.0) continue;

            float root = sqrt(discriminant);
            float nearDistance = -originProjection - root;

            if (nearDistance > 1e-5 && nearDistance < horizonDistance) {
                vec3 crossing = origin + tangent * nearDistance;
                if (
                    photonLabelShell
                    && surfaceOpacity < 0.999
                    && nearDistance < structureDistance
                ) {
                    accumulatePhotonLabelHit(
                        crossing,
                        tangent,
                        1.0,
                        overlayLight,
                        overlayOpacity
                    );
                }
                if (shellEnabled && spheresActive) {
                    accumulateSphereHit(
                        crossing,
                        tangent,
                        shell,
                        1.0,
                        surfaceLight,
                        surfaceOpacity
                    );
                }
            }
        }

        // Inside-to-outside far hits continue that front-to-back ordering.
        for (int shell = 0; shell < SHELL_COUNT; ++shell) {
            bool shellEnabled = spheresActive && shell < uShellCount;
            bool photonLabelShell = labelActive && shell == 2;
            if (!shellEnabled && !photonLabelShell) continue;
            float radius = SHELL_RADII[shell];
            float discriminant =
                originProjection * originProjection - (dot(origin, origin) - radius * radius);
            if (discriminant < 0.0) continue;

            float farDistance = -originProjection + sqrt(discriminant);
            if (farDistance > 1e-5 && farDistance < horizonDistance) {
                vec3 crossing = origin + tangent * farDistance;
                if (
                    photonLabelShell
                    && surfaceOpacity < 0.999
                    && farDistance < structureDistance
                ) {
                    accumulatePhotonLabelHit(
                        crossing,
                        tangent,
                        1.0,
                        overlayLight,
                        overlayOpacity
                    );
                }
                if (shellEnabled && spheresActive) {
                    accumulateSphereHit(
                        crossing,
                        tangent,
                        shell,
                        1.0,
                        surfaceLight,
                        surfaceOpacity
                    );
                }
            }
        }
    }

}

vec2 directionToEquirectangular(vec3 direction) {
    vec3 ray = normalize(direction);
    float longitude = atan(ray.z, ray.x);
    float latitude = asin(clamp(ray.y, -1.0, 1.0));
    return vec2(longitude / TAU + 0.5, latitude / PI + 0.5);
}

vec3 adjustSaturation(vec3 color, float saturation) {
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luminance), color, saturation);
}

vec2 packMotionCoordinate(float coordinate) {
    const float largestValidCode = 65534.0;
    float code =
        floor(
            clamp(
                coordinate,
                0.0,
                largestValidCode / 65535.0
            ) * 65535.0
            + 0.5
        );
    return
        vec2(
            floor(code / 256.0),
            mod(code, 256.0)
        ) / 255.0;
}

vec4 packPreviousUv(vec2 previousUv) {
    vec2 packedU = packMotionCoordinate(previousUv.x);
    vec2 packedV = packMotionCoordinate(previousUv.y);
    return vec4(packedU, packedV);
}

bool projectPreviousWorldPoint(
    vec3 worldPoint,
    out vec2 previousUv
) {
    vec3 relativePoint =
        worldPoint - uPreviousCameraPosition;
    float forwardDistance =
        dot(relativePoint, uPreviousCameraForward);
    if (forwardDistance <= 1e-5) {
        previousUv = vec2(0.0);
        return false;
    }

    float previousFocalScale =
        tan(0.5 * uPreviousFovY);
    float aspect =
        uResolution.x / max(uResolution.y, 1.0);
    vec2 previousScreen = vec2(
        dot(relativePoint, uPreviousCameraRight)
            / max(
                forwardDistance
                * aspect
                * previousFocalScale,
                1e-6
            ),
        dot(relativePoint, uPreviousCameraUp)
            / max(
                forwardDistance
                * previousFocalScale,
                1e-6
            )
    );
    previousUv = previousScreen * 0.5 + 0.5;
    return
        all(greaterThanEqual(previousUv, vec2(0.0)))
        && all(lessThanEqual(previousUv, vec2(1.0)));
}

bool projectPreviousSkyDirection(
    vec3 worldDirection,
    out vec2 previousUv
) {
    vec3 direction = normalize(worldDirection);
    float forwardDistance =
        dot(direction, uPreviousCameraForward);
    if (forwardDistance <= 1e-5) {
        previousUv = vec2(0.0);
        return false;
    }

    float previousFocalScale =
        tan(0.5 * uPreviousFovY);
    float aspect =
        uResolution.x / max(uResolution.y, 1.0);
    vec2 previousScreen = vec2(
        dot(direction, uPreviousCameraRight)
            / max(
                forwardDistance
                * aspect
                * previousFocalScale,
                1e-6
            ),
        dot(direction, uPreviousCameraUp)
            / max(
                forwardDistance
                * previousFocalScale,
                1e-6
            )
    );
    previousUv = previousScreen * 0.5 + 0.5;
    return
        all(greaterThanEqual(previousUv, vec2(0.0)))
        && all(lessThanEqual(previousUv, vec2(1.0)));
}

vec3 stationPointAtPreviousTime(
    vec3 currentWorldPoint,
    int assemblyIndex
) {
    vec3 objectPoint = stationAssemblyRotatingSourcePoint(
        currentWorldPoint / STATION_SCALE,
        assemblyIndex,
        uTime
    );
    vec3 previousAssemblyPoint = stationRotateY(
        objectPoint,
        -uStationRotationSpeed * uPreviousTime
    );
    return
        stationAssemblyToWorld(
            previousAssemblyPoint,
            assemblyIndex
        ) * STATION_SCALE;
}

void main() {
    stationMotionHit = false;
    stationMotionPoint = vec3(0.0);
    stationMotionDepth = 0.0;
    stationMotionAssemblyIndex = 0;
    staticMotionHit = false;
    staticMotionPoint = vec3(0.0);
    staticMotionDepth = 0.0;
    horizonMotionHit = false;
    horizonMotionPoint = vec3(0.0);
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float focalScale = tan(0.5 * uFovY);
    vec2 jitteredScreen =
        vScreen + (2.0 * uJitter / uResolution);
    vec3 tangent = normalize(
        uCameraForward
        + uCameraRight
            * jitteredScreen.x
            * aspect
            * focalScale
        + uCameraUp * jitteredScreen.y * focalScale
    );
    vec3 position = uCameraPosition;
    vec3 overlayLight = vec3(0.0);
    float overlayOpacity = 0.0;
    vec3 surfaceLight = vec3(0.0);
    float surfaceOpacity = 0.0;
    vec3 structureLight = vec3(0.0);
    float structureOpacity = 0.0;
    bool captured = false;
    bool escaped = false;
    bool invalidRay = false;

    if (!uLensing) {
        traceFlatScene(
            position,
            tangent,
            overlayLight,
            overlayOpacity,
            surfaceLight,
            surfaceOpacity,
            structureLight,
            structureOpacity,
            captured
        );
        escaped = !captured;
    } else {
        for (int stepIndex = 0; stepIndex < HARD_MAX_STEPS; ++stepIndex) {
            if (stepIndex >= uMaxSteps) break;

            float oldRadius = length(position);
            if (oldRadius <= CAPTURE_RHO) {
                captured = true;
                break;
            }

            if (oldRadius > ESCAPE_RHO && dot(position, tangent) > 0.0) {
                escaped = true;
                break;
            }

            float rayStep = adaptiveStep(position);
            float inwardRate = -dot(normalize(position), tangent);
            if (inwardRate > 0.02) {
                float safeInfallStep = 0.72 * (oldRadius - CAPTURE_RHO) / inwardRate;
                rayStep = min(rayStep, max(0.0015, safeInfallStep));
            }
            vec3 oldPosition = position;
            vec3 firstAcceleration = opticalAcceleration(position, tangent);
            vec3 midpointTangent = normalize(tangent + 0.5 * rayStep * firstAcceleration);
            vec3 midpointPosition = position + 0.5 * rayStep * tangent;

            if (length(midpointPosition) <= CAPTURE_RHO) {
                captured = true;
                break;
            }

            vec3 midpointAcceleration = opticalAcceleration(midpointPosition, midpointTangent);
            position += rayStep * midpointTangent;
            tangent = normalize(tangent + rayStep * midpointAcceleration);

            if (
                any(isnan(position)) || any(isinf(position))
                || any(isnan(tangent)) || any(isinf(tangent))
            ) {
                invalidRay = true;
                captured = true;
                break;
            }

            float structureT;
            accumulateDysonSegment(
                oldPosition,
                position,
                tangent,
                surfaceOpacity,
                structureT,
                structureLight,
                structureOpacity
            );
            accumulateShellCrossings(
                oldPosition,
                position,
                tangent,
                overlayLight,
                overlayOpacity,
                surfaceLight,
                surfaceOpacity,
                structureT
            );
            if (
                surfaceOpacity >= 0.999
                || structureOpacity >= 0.999
            ) break;
        }
    }

    if (!captured && length(position) > ESCAPE_RHO && dot(position, tangent) > 0.0) {
        escaped = true;
    }

    bool unresolved = !captured && !escaped && !invalidRay;
    float finalRadius = length(position);
    float impactParameter = 0.0;
    if (unresolved && finalRadius > CAPTURE_RHO) {
        impactParameter = opticalIndex(finalRadius) * length(cross(position, tangent));
        bool inward = dot(position, tangent) < 0.0;
        bool insidePhotonSphere = finalRadius < PHOTON_RHO;
        bool outsideCapture =
            !insidePhotonSphere
            && inward
            && impactParameter < CRITICAL_IMPACT * 0.999;
        bool insideCapture =
            insidePhotonSphere
            && (inward || impactParameter > CRITICAL_IMPACT * 1.001);
        if (outsideCapture || insideCapture) {
            captured = true;
            unresolved = false;
        }
    }

    vec3 safeSkyDirection = invalidRay ? uCameraForward : tangent;
    vec2 skyUv = directionToEquirectangular(safeSkyDirection);
    float textureHeight = float(textureSize(uSky, 0).y);
    float skyLod = max(0.0, log2(max(uFovY * textureHeight / (PI * uResolution.y), 1.0)));
    vec3 sampledSky = uSkyVisible
        ? textureLod(uSky, skyUv, min(skyLod * 0.65, 2.0)).rgb
        : vec3(0.0);

    vec3 sceneColor = vec3(0.0);
    if (!captured && !invalidRay) {
        if (unresolved) {
            float criticalSeparation =
                abs(impactParameter - CRITICAL_IMPACT) / CRITICAL_IMPACT;
            float impactConfidence = smoothstep(0.006, 0.075, criticalSeparation);
            float outwardConfidence =
                smoothstep(5.0, 15.0, finalRadius)
                * smoothstep(0.02, 0.35, dot(normalize(position), tangent));
            float confidence = max(impactConfidence, outwardConfidence);
            sampledSky *= mix(0.22, 1.0, confidence);
        }
        sceneColor = sampledSky;
    }

    // Opaque shell material remains visible even when the ray behind it would
    // eventually be captured by the horizon.
    sceneColor = sceneColor * (1.0 - surfaceOpacity) + surfaceLight;
    sceneColor =
        sceneColor * (1.0 - structureOpacity) + structureLight;
    sceneColor *= 1.0 - overlayOpacity * 0.42;
    sceneColor += overlayLight;
    sceneColor = max(sceneColor, vec3(0.0));
    sceneColor = adjustSaturation(sceneColor, uSaturation);
    sceneColor = vec3(1.0) - exp(-sceneColor * uExposure);
    sceneColor = pow(max(sceneColor, vec3(0.0)), vec3(1.0 / 2.2));

    float historyDepth = 1.0;
    if (stationMotionHit && structureOpacity >= 0.999) {
        historyDepth =
            clamp(
                log2(1.0 + stationMotionDepth)
                / log2(1.0 + ESCAPE_RHO),
                0.0,
                1.0
            );
    } else if (
        staticMotionHit
        && surfaceOpacity > 0.001
    ) {
        historyDepth =
            clamp(
                log2(1.0 + staticMotionDepth)
                / log2(1.0 + ESCAPE_RHO),
                0.0,
                1.0
            );
    } else if (captured && horizonMotionHit) {
        historyDepth =
            clamp(
                log2(
                    1.0
                    + length(
                        horizonMotionPoint
                        - uCameraPosition
                    )
                )
                / log2(1.0 + ESCAPE_RHO),
                0.0,
                1.0
            );
    }

    outMotion = vec4(1.0);
    if (
        uMotionValid
        && !uLensing
        && overlayOpacity < 0.001
    ) {
        vec2 previousUv;
        bool validPreviousUv = false;
        if (stationMotionHit && structureOpacity >= 0.999) {
            vec3 previousWorldPoint =
                stationPointAtPreviousTime(
                    stationMotionPoint,
                    stationMotionAssemblyIndex
                );
            validPreviousUv =
                projectPreviousWorldPoint(
                    previousWorldPoint,
                    previousUv
                );
        } else if (
            staticMotionHit
            && surfaceOpacity > 0.001
        ) {
            validPreviousUv =
                projectPreviousWorldPoint(
                    staticMotionPoint,
                    previousUv
                );
        } else if (captured && horizonMotionHit) {
            validPreviousUv =
                projectPreviousWorldPoint(
                    horizonMotionPoint,
                    previousUv
                );
        } else if (
            surfaceOpacity < 0.001
            && overlayOpacity < 0.001
            && !captured
            && !invalidRay
        ) {
            validPreviousUv =
                projectPreviousSkyDirection(
                    safeSkyDirection,
                    previousUv
                );
        }
        if (validPreviousUv) {
            previousUv -=
                uJitter / max(uResolution, vec2(1.0));
            validPreviousUv =
                all(
                    greaterThanEqual(
                        previousUv,
                        vec2(0.0)
                    )
                )
                && all(
                    lessThanEqual(
                        previousUv,
                        vec2(1.0)
                    )
                );
        }
        if (validPreviousUv) {
            outMotion = packPreviousUv(previousUv);
        }
    }

    outColor = vec4(sceneColor, historyDepth);
}
