#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vScreen;
layout(location = 0) out vec4 outColor;

uniform vec2 uResolution;
uniform vec3 uCameraPosition;
uniform float uTime;
uniform float uStationRotationSpeed;
uniform float uFovY;
uniform bool uLensing;
uniform bool uSkyVisible;
uniform bool uRingsVisible;
uniform float uExposure;
uniform float uSaturation;
uniform sampler2D uSky;
uniform sampler2D uRayTransfer;
uniform sampler2D uPhotonCrossing;
uniform vec2 uTransferRhoRange;
uniform mat4 uInverseProjection;
uniform mat3 uEyeRotation;

const float PI = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;
const float PHOTON_RHO = 1.8660254037844386;
const float SKY_BRIGHTNESS = 0.5;
const float BAND_LATITUDE = 0.1875;
const float BAND_HALF_WIDTH = 0.1125;

float saturate(float value) {
    return clamp(value, 0.0, 1.0);
}

vec3 initialRayDirection() {
    vec4 eyePoint = uInverseProjection * vec4(vScreen, 1.0, 1.0);
    float safeW = abs(eyePoint.w) > 1e-7 ? eyePoint.w : 1.0;
    vec3 eyeDirection = normalize(eyePoint.xyz / safeW);
    return normalize(uEyeRotation * eyeDirection);
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

ivec2 transferCoordinate(float rho, float radialCosine) {
    ivec2 dimensions = textureSize(uRayTransfer, 0);
    float angleCoordinate = clamp(radialCosine * 0.5 + 0.5, 0.0, 1.0);
    float radiusCoordinate = clamp(
        (rho - uTransferRhoRange.x)
        / max(uTransferRhoRange.y - uTransferRhoRange.x, 1e-6),
        0.0,
        1.0
    );
    return ivec2(
        int(floor(angleCoordinate * float(dimensions.x - 1) + 0.5)),
        int(floor(radiusCoordinate * float(dimensions.y - 1) + 0.5))
    );
}

vec3 stablePlaneTangent(
    vec3 radialDirection,
    vec3 initialDirection,
    float radialCosine
) {
    vec3 transverse = initialDirection - radialDirection * radialCosine;
    float transverseLength = length(transverse);
    if (transverseLength > 1e-6) return transverse / transverseLength;
    vec3 helper = abs(radialDirection.y) < 0.9
        ? vec3(0.0, 1.0, 0.0)
        : vec3(1.0, 0.0, 0.0);
    return normalize(cross(helper, radialDirection));
}

float projectedFootprint(vec3 point) {
    float distanceFromEye = length(point - uCameraPosition);
    return max(
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
    float angularAa = clamp(footprint / PHOTON_RHO, 0.0012, 0.025);
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
    vec3 facingNormal = dot(radialNormal, viewDirection) >= 0.0
        ? radialNormal
        : -radialNormal;
    float rotation = uTime * uStationRotationSpeed;
    float longitude = atan(point.z, point.x) - rotation;
    float latitude = asin(clamp(radialNormal.y, -1.0, 1.0));
    float phase = fract(longitude / TAU * 72.0 + 0.5);
    float phaseDistance = min(phase, 1.0 - phase);
    float angularAa = clamp(footprint / PHOTON_RHO, 0.0012, 0.035);
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
    if (!uRingsVisible) return;
    float footprint = projectedFootprint(crossing);
    float coverage = doubleBandCoverage(crossing, footprint);
    if (coverage <= 0.001) return;
    float alpha = saturate(coverage * 1.10);
    bandLight += alpha * doubleBandMaterial(
        crossing,
        rayDirection,
        coverage,
        footprint
    );
    bandOpacity = alpha;
}

void main() {
    vec3 initialDirection = initialRayDirection();
    vec3 skyDirection = initialDirection;
    vec3 bandLight = vec3(0.0);
    float bandOpacity = 0.0;
    bool captured = false;

    if (uLensing) {
        float rho = length(uCameraPosition);
        vec3 radialDirection = uCameraPosition / max(rho, 1e-7);
        float radialCosine = clamp(
            dot(initialDirection, radialDirection),
            -1.0,
            1.0
        );
        vec3 planeTangent = stablePlaneTangent(
            radialDirection,
            initialDirection,
            radialCosine
        );
        ivec2 coordinate = transferCoordinate(rho, radialCosine);
        vec4 transfer = texelFetch(uRayTransfer, coordinate, 0);
        captured = transfer.z < 0.5;
        skyDirection = normalize(
            transfer.x * radialDirection + transfer.y * planeTangent
        );

        vec4 crossing = texelFetch(uPhotonCrossing, coordinate, 0);
        if (dot(crossing.xy, crossing.xy) > 0.5) {
            vec3 crossingPosition = PHOTON_RHO * (
                crossing.x * radialDirection
                + crossing.y * planeTangent
            );
            vec3 crossingTangent = normalize(
                crossing.z * radialDirection
                + crossing.w * planeTangent
            );
            accumulateDoubleBandCrossing(
                crossingPosition,
                crossingTangent,
                bandLight,
                bandOpacity
            );
        }
    }

    vec2 skyUv = directionToEquirectangular(skyDirection);
    float textureHeight = float(textureSize(uSky, 0).y);
    float skyLod = max(
        0.0,
        log2(max(uFovY * textureHeight / (PI * uResolution.y), 1.0))
    );
    vec3 sampledSky = uSkyVisible
        ? textureLod(uSky, skyUv, min(skyLod * 0.55, 1.6)).rgb
        : vec3(0.0);
    sampledSky *= SKY_BRIGHTNESS;

    vec3 sceneColor = captured ? vec3(0.0) : sampledSky;
    sceneColor = sceneColor * (1.0 - bandOpacity) + bandLight;
    sceneColor = adjustSaturation(max(sceneColor, vec3(0.0)), uSaturation);
    sceneColor = vec3(1.0) - exp(-sceneColor * uExposure);
    sceneColor = pow(max(sceneColor, vec3(0.0)), vec3(1.0 / 2.2));
    outColor = vec4(sceneColor, 1.0);
}
