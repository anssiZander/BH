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
uniform float uTime;
uniform float uStationRotationSpeed;
uniform float uFovY;
uniform int uMaxSteps;
uniform float uBaseStep;
uniform bool uLensing;
uniform bool uSkyVisible;
uniform bool uRingsVisible;
uniform float uExposure;
uniform float uSaturation;
uniform sampler2D uSky;

// WebXR supplies an asymmetric projection and an eye pose for every view.
// Desktop rendering continues to use the original camera basis.
uniform bool uXRView;
uniform mat4 uInverseProjection;
uniform mat3 uEyeRotation;

const float PI = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;
const float M = 1.0;
const float CAPTURE_RHO = 0.515;
const float PHOTON_RHO = 1.8660254037844386;
const float CRITICAL_IMPACT = 5.196152422706632;
const float ESCAPE_RHO = 36.0;
const float SKY_BRIGHTNESS = 0.5;
const int HARD_MAX_STEPS = 896;

const float BAND_LATITUDE = 0.1875;
const float BAND_HALF_WIDTH = 0.1125;

float saturate(float value) {
    return clamp(value, 0.0, 1.0);
}

float opticalIndex(float rho) {
    float a = M / (2.0 * rho);
    return ((1.0 + a) * (1.0 + a) * (1.0 + a)) / (1.0 - a);
}

vec3 opticalAcceleration(vec3 position, vec3 tangent) {
    float rho = length(position);
    if (rho <= CAPTURE_RHO) return vec3(0.0);

    float a = M / (2.0 * rho);
    float denominator = max(1.0 - a, 1e-5);
    float dLogNdr =
        -(a / rho)
        * (3.0 / (1.0 + a) + 1.0 / denominator);
    vec3 gradient = position * (dLogNdr / rho);
    return gradient - tangent * dot(tangent, gradient);
}

float adaptiveStep(vec3 point) {
    float rho = length(point);
    float interpolation = smoothstep(1.2, 18.0, rho);
    float rayStep = uBaseStep * mix(0.35, 6.0, interpolation);

    // Near-critical geodesics need the smallest steps. The band itself is
    // intersected analytically, so no expensive distance-field refinement is
    // required here.
    float photonBlend = smoothstep(0.0, 0.30, abs(rho - PHOTON_RHO));
    float photonMinimum = uXRView ? 0.034 : 0.018;
    rayStep = min(rayStep, mix(photonMinimum, rayStep, photonBlend));
    return rayStep;
}

vec3 initialRayDirection() {
    if (uXRView) {
        vec4 eyePoint =
            uInverseProjection * vec4(vScreen, 1.0, 1.0);
        float safeW = abs(eyePoint.w) > 1e-7 ? eyePoint.w : 1.0;
        vec3 eyeDirection = normalize(eyePoint.xyz / safeW);
        return normalize(uEyeRotation * eyeDirection);
    }

    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float focalScale = tan(0.5 * uFovY);
    return normalize(
        uCameraForward
        + uCameraRight * vScreen.x * aspect * focalScale
        + uCameraUp * vScreen.y * focalScale
    );
}

vec2 directionToEquirectangular(vec3 direction) {
    vec3 ray = normalize(direction);
    return vec2(
        atan(ray.z, ray.x) / TAU + 0.5,
        asin(clamp(ray.y, -1.0, 1.0)) / PI + 0.5
    );
}

vec3 adjustSaturation(vec3 color, float amount) {
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luminance), color, amount);
}

bool segmentSphereRoots(
    vec3 start,
    vec3 end,
    float radius,
    out float firstRoot,
    out float secondRoot
) {
    vec3 segment = end - start;
    float a = dot(segment, segment);
    if (a <= 1e-14) {
        firstRoot = 2.0;
        secondRoot = 2.0;
        return false;
    }

    float b = 2.0 * dot(start, segment);
    float c = dot(start, start) - radius * radius;
    float discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0) {
        firstRoot = 2.0;
        secondRoot = 2.0;
        return false;
    }

    float root = sqrt(max(discriminant, 0.0));
    float inverseDenominator = 0.5 / a;
    firstRoot = (-b - root) * inverseDenominator;
    secondRoot = (-b + root) * inverseDenominator;
    return true;
}

float projectedFootprint(vec3 point) {
    float distanceFromEye = length(point - uCameraPosition);
    return
        max(
            2.0
            * distanceFromEye
            * tan(0.5 * uFovY)
            / max(uResolution.y, 1.0),
            0.00035
        );
}

float doubleBandCoverage(vec3 point, float footprint) {
    vec3 normal = normalize(point);
    float latitude = asin(clamp(normal.y, -1.0, 1.0));
    float distanceFromCenter = abs(abs(latitude) - BAND_LATITUDE);
    float angularAa =
        clamp(footprint / PHOTON_RHO, 0.0012, 0.025);
    return 1.0 - smoothstep(
        BAND_HALF_WIDTH - angularAa,
        BAND_HALF_WIDTH + angularAa,
        distanceFromCenter
    );
}

vec3 doubleBandMaterial(
    vec3 point,
    vec3 rayDirection,
    float coverage,
    float footprint
) {
    vec3 radialNormal = normalize(point);
    vec3 viewDirection = normalize(-rayDirection);
    vec3 facingNormal =
        dot(radialNormal, viewDirection) >= 0.0
        ? radialNormal
        : -radialNormal;

    float rotation = uTime * uStationRotationSpeed;
    float longitude = atan(point.z, point.x) - rotation;
    float latitude = asin(clamp(radialNormal.y, -1.0, 1.0));
    float phase = fract(longitude / TAU * 72.0 + 0.5);
    float phaseDistance = min(phase, 1.0 - phase);
    float angularAa =
        clamp(footprint / PHOTON_RHO, 0.0012, 0.035);
    float panelLine = 1.0 - smoothstep(
        0.010,
        0.010 + angularAa * 2.5,
        phaseDistance
    );

    float bandCoordinate =
        abs(abs(latitude) - BAND_LATITUDE) / BAND_HALF_WIDTH;
    float edgeRail = smoothstep(0.72, 0.94, bandCoordinate);
    float innerChannel =
        1.0 - smoothstep(0.030, 0.095, abs(bandCoordinate - 0.48));
    float windowPattern =
        smoothstep(0.20, 0.42, sin(longitude * 144.0) * 0.5 + 0.5)
        * (1.0 - edgeRail)
        * smoothstep(0.16, 0.35, bandCoordinate);

    vec3 gold = vec3(0.96, 0.57, 0.12);
    vec3 darkMetal = vec3(0.085, 0.105, 0.135);
    vec3 material = mix(gold, darkMetal, panelLine * 0.82);
    material = mix(material, vec3(1.0, 0.78, 0.24), edgeRail * 0.78);
    material = mix(material, vec3(0.12, 0.27, 0.37), innerChannel * 0.62);

    vec3 keyDirection = normalize(vec3(-0.42, 0.74, 0.52));
    vec3 halfVector = normalize(keyDirection + viewDirection);
    float diffuse = 0.26 + 0.74 * max(dot(facingNormal, keyDirection), 0.0);
    float rim = pow(1.0 - abs(dot(facingNormal, viewDirection)), 2.6);
    float specular = pow(max(dot(facingNormal, halfVector), 0.0), 38.0);

    vec3 shaded = material * diffuse;
    shaded += vec3(1.0, 0.72, 0.28) * specular * 0.65;
    shaded += material * rim * 0.30;
    shaded += vec3(0.06, 0.48, 0.72) * windowPattern * 0.48;
    return shaded * coverage;
}

void accumulateDoubleBandCrossing(
    vec3 crossing,
    vec3 rayDirection,
    inout vec3 bandLight,
    inout float bandOpacity
) {
    if (!uRingsVisible || bandOpacity >= 0.999) return;
    float footprint = projectedFootprint(crossing);
    float coverage = doubleBandCoverage(crossing, footprint);
    if (coverage <= 0.001) return;

    float alpha = saturate(coverage * 1.10);
    vec3 material = doubleBandMaterial(
        crossing,
        rayDirection,
        coverage,
        footprint
    );
    bandLight += (1.0 - bandOpacity) * alpha * material;
    bandOpacity += (1.0 - bandOpacity) * alpha;
}

void accumulateDoubleBandSegment(
    vec3 start,
    vec3 end,
    vec3 rayDirection,
    inout vec3 bandLight,
    inout float bandOpacity
) {
    if (!uRingsVisible || bandOpacity >= 0.999) return;
    float startSide = length(start) - PHOTON_RHO;
    float endSide = length(end) - PHOTON_RHO;
    if (startSide * endSide > 0.0) return;

    float firstRoot;
    float secondRoot;
    if (!segmentSphereRoots(
        start,
        end,
        PHOTON_RHO,
        firstRoot,
        secondRoot
    )) return;

    vec3 segment = end - start;
    if (firstRoot >= 0.0 && firstRoot <= 1.0) {
        accumulateDoubleBandCrossing(
            start + segment * firstRoot,
            rayDirection,
            bandLight,
            bandOpacity
        );
    }
    if (
        bandOpacity < 0.999
        && secondRoot >= 0.0
        && secondRoot <= 1.0
        && abs(secondRoot - firstRoot) > 1e-5
    ) {
        accumulateDoubleBandCrossing(
            start + segment * secondRoot,
            rayDirection,
            bandLight,
            bandOpacity
        );
    }
}

void main() {
    vec3 position = uCameraPosition;
    vec3 tangent = initialRayDirection();
    vec3 bandLight = vec3(0.0);
    float bandOpacity = 0.0;
    bool captured = false;
    bool escaped = false;
    bool invalidRay = false;

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
            float safeInfallStep =
                0.72 * (oldRadius - CAPTURE_RHO) / inwardRate;
            rayStep = min(rayStep, max(0.0015, safeInfallStep));
        }

        vec3 oldPosition = position;
        if (uLensing) {
            if (uXRView) {
                // Playability-first XR path: one field evaluation instead of
                // the desktop midpoint method's two evaluations per step.
                vec3 acceleration = opticalAcceleration(position, tangent);
                vec3 midpointTangent = normalize(
                    tangent + 0.5 * rayStep * acceleration
                );
                position += rayStep * midpointTangent;
                tangent = normalize(tangent + rayStep * acceleration);
            } else {
                vec3 firstAcceleration = opticalAcceleration(position, tangent);
                vec3 midpointTangent = normalize(
                    tangent + 0.5 * rayStep * firstAcceleration
                );
                vec3 midpointPosition = position + 0.5 * rayStep * tangent;
                if (length(midpointPosition) <= CAPTURE_RHO) {
                    captured = true;
                    break;
                }
                vec3 midpointAcceleration = opticalAcceleration(
                    midpointPosition,
                    midpointTangent
                );
                position += rayStep * midpointTangent;
                tangent = normalize(
                    tangent + rayStep * midpointAcceleration
                );
            }
        } else {
            position += rayStep * tangent;
        }

        if (
            any(isnan(position)) || any(isinf(position))
            || any(isnan(tangent)) || any(isinf(tangent))
        ) {
            invalidRay = true;
            captured = true;
            break;
        }

        accumulateDoubleBandSegment(
            oldPosition,
            position,
            tangent,
            bandLight,
            bandOpacity
        );
        if (bandOpacity >= 0.999) break;

        if (length(position) <= CAPTURE_RHO) {
            captured = true;
            break;
        }
    }

    if (
        !captured
        && length(position) > ESCAPE_RHO
        && dot(position, tangent) > 0.0
    ) {
        escaped = true;
    }

    bool unresolved = !captured && !escaped && !invalidRay;
    float finalRadius = length(position);
    float impactParameter = 0.0;
    if (unresolved && finalRadius > CAPTURE_RHO) {
        impactParameter =
            opticalIndex(finalRadius)
            * length(cross(position, tangent));
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
    float skyLod = max(
        0.0,
        log2(
            max(
                uFovY * textureHeight / (PI * uResolution.y),
                1.0
            )
        )
    );
    vec3 sampledSky = uSkyVisible
        ? textureLod(uSky, skyUv, min(skyLod * 0.55, 1.6)).rgb
        : vec3(0.0);
    sampledSky *= SKY_BRIGHTNESS;

    vec3 sceneColor = vec3(0.0);
    if (!captured && !invalidRay) {
        if (unresolved) {
            float criticalSeparation =
                abs(impactParameter - CRITICAL_IMPACT) / CRITICAL_IMPACT;
            float impactConfidence =
                smoothstep(0.006, 0.075, criticalSeparation);
            float outwardConfidence =
                smoothstep(5.0, 15.0, finalRadius)
                * smoothstep(
                    0.02,
                    0.35,
                    dot(normalize(position), tangent)
                );
            sampledSky *= mix(
                0.22,
                1.0,
                max(impactConfidence, outwardConfidence)
            );
        }
        sceneColor = sampledSky;
    }

    sceneColor = sceneColor * (1.0 - bandOpacity) + bandLight;
    sceneColor = max(sceneColor, vec3(0.0));
    sceneColor = adjustSaturation(sceneColor, uSaturation);
    sceneColor = vec3(1.0) - exp(-sceneColor * uExposure);
    sceneColor = pow(max(sceneColor, vec3(0.0)), vec3(1.0 / 2.2));

    // The lensed field has no unique pinhole reprojection. Mark motion as
    // invalid so the desktop fallback uses its spatial resolve, and keep the
    // XR path single-pass and latency-friendly.
    outMotion = vec4(1.0);
    outColor = vec4(sceneColor, 1.0);
}
