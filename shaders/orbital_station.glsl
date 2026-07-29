/*
 * CC0 geometry port from ShaderToy X33BRn, "[TAA] Orbital Megastructure"
 * by morimea, based on WlKXzm, "Orbital Megastructure" by Otavio Good.
 *
 * This file preserves the source ring hull and procedural material helpers,
 * then folds two band copies over each hemisphere's spherical latitude and
 * mirrors them across the equator. The source cross-lattice, hub, radial
 * spokes, communications mast, and dishes are intentionally omitted from the
 * rendered scene along with camera state, Earth/environment rendering, TAA,
 * FSR, post-processing, and otherwise dead geometry.
 *
 * Inclusion contract: PI, PHOTON_RHO, STATION_INNER_BAND_LATITUDE,
 * STATION_OUTER_BAND_LATITUDE, uTime, and saturate(float) are defined first.
 */

const float STATION_SCALE = PHOTON_RHO / 8.0;
const float STATION_ROT_SPEED = 0.015;
const float STATION_BAND_HALF_ARC = 1.0;

const uint STATION_MAT_FLOOR = 1u;
const uint STATION_MAT_WALL = 2u;
const uint STATION_MAT_PIPE = 3u;
const uint STATION_MAT_CHROME = 4u;
const uint STATION_MAT_GLOSSY_ROUGH = 5u;
const uint STATION_MAT_SIDE_WINDOWS = 6u;
const uint STATION_MAT_YELLOW = 7u;
const uint STATION_MAT_BORING = 8u;
const uint STATION_MAT_DOME = 9u;
const uint STATION_MAT_SOLAR_PANEL = 100u;
const uint STATION_MAT_SPOKE = 101u;
const uint STATION_MAT_RGB = 202u;

const uint STATION_NICE_COLORS[4] = uint[](
    STATION_MAT_RGB | (76u << 24) | (67u << 16) | (8u << 8),
    STATION_MAT_RGB | (76u << 24) | (10u << 16) | (4u << 8),
    STATION_MAT_RGB | (50u << 24) | (96u << 16) | (86u << 8),
    STATION_MAT_RGB | (10u << 24) | (7u << 16) | (3u << 8)
);

const float STATION_INV_MAX_24_BIT = 1.0 / float(0xffffff);
const vec2 STATION_ZERO_ONE = vec2(0.0, 1.0);

vec2 stationRotate(vec2 value, float radians) {
    float cosine = cos(radians);
    float sine = sin(radians);
    return vec2(
        cosine * value.x - sine * value.y,
        sine * value.x + cosine * value.y
    );
}

vec3 stationRotateX(vec3 value, float radians) {
    float cosine = cos(radians);
    float sine = sin(radians);
    return vec3(
        value.x,
        cosine * value.y + sine * value.z,
        -sine * value.y + cosine * value.z
    );
}

vec3 stationRotateY(vec3 value, float radians) {
    float cosine = cos(radians);
    float sine = sin(radians);
    return vec3(
        cosine * value.x - sine * value.z,
        value.y,
        sine * value.x + cosine * value.z
    );
}

vec3 stationRotateZ(vec3 value, float radians) {
    float cosine = cos(radians);
    float sine = sin(radians);
    return vec3(
        cosine * value.x + sine * value.y,
        -sine * value.x + cosine * value.y,
        value.z
    );
}

vec3 stationRotatingSourcePoint(vec3 sourcePoint) {
    return stationRotateY(
        sourcePoint,
        STATION_ROT_SPEED * uTime
    );
}

uint stationSmallHashA(in uint seed) {
    return (seed ^ 1057926937u) * 3812423987u
        ^ ((seed * seed) * 4000000007u);
}

uint stationSmallHashB(in uint seed) {
    return (seed ^ 2156034509u) * 3699529241u;
}

vec4 stationHashVec4(uint seed) {
    seed = stationSmallHashA(seed);
    seed = (seed << 13) | (seed >> 19);
    seed = stationSmallHashB(seed);
    return vec4(
        (seed >> 8) & 0x3fu,
        (seed >> 14) & 0x3fu,
        (seed >> 20) & 0x3fu,
        (seed >> 26) & 0x3fu
    ) / float(0x3fu);
}

vec4 stationHashVec4I2(ivec2 seedPair) {
    return stationHashVec4(
        uint(seedPair.x ^ (seedPair.y * 65537))
    );
}

float stationHash13(vec3 point) {
    point = fract(point * 0.1031);
    point += dot(point, point.zyx + 31.32);
    return fract((point.x + point.y) * point.z);
}

float stationMixP(float first, float second, float amount) {
    return mix(
        first,
        second,
        amount * amount * (3.0 - 2.0 * amount)
    );
}

float stationNoise(vec3 point) {
    vec3 fractional = fract(point);
    vec3 cell = floor(point);
    float h000 = stationHash13(cell);
    float h100 = stationHash13(cell + STATION_ZERO_ONE.yxx);
    float h010 = stationHash13(cell + STATION_ZERO_ONE.xyx);
    float h110 = stationHash13(cell + STATION_ZERO_ONE.yyx);
    float h001 = stationHash13(cell + STATION_ZERO_ONE.xxy);
    float h101 = stationHash13(cell + STATION_ZERO_ONE.yxy);
    float h011 = stationHash13(cell + STATION_ZERO_ONE.xyy);
    float h111 = stationHash13(cell + STATION_ZERO_ONE.yyy);
    return stationMixP(
        stationMixP(
            stationMixP(h000, h100, fractional.x),
            stationMixP(h010, h110, fractional.x),
            fractional.y
        ),
        stationMixP(
            stationMixP(h001, h101, fractional.x),
            stationMixP(h011, h111, fractional.x),
            fractional.y
        ),
        fractional.z
    );
}

vec3 stationMinGradient(vec3 first, vec3 second) {
    return first.x < second.x ? first : second;
}

vec3 stationPanelCircle(vec2 uv, float radius) {
    vec2 gradient = uv / max(length(uv), 1e-8);
    return vec3(length(uv) - radius, gradient);
}

vec3 stationPanelBox(vec2 uv, vec2 radius) {
    vec2 gradient =
        abs(uv.x * radius.y) > abs(uv.y * radius.x)
        ? vec2(1.0, 0.0)
        : vec2(0.0, 1.0);
    gradient *= sign(uv);

    vec2 distanceToEdge = abs(uv) - radius;
    float distanceValue =
        min(max(distanceToEdge.x, distanceToEdge.y), 0.0)
        + length(max(distanceToEdge, 0.0));
    return vec3(distanceValue, gradient);
}

vec4 stationTexPanels(vec2 uv, out vec3 normal) {
    vec4 hash = stationHashVec4I2(ivec2(floor(uv)));
    vec4 hash2 = stationHashVec4I2(ivec2(hash * 8192.0));
    vec4 hash3 = stationHashVec4I2(ivec2(hash2 * 8192.0));
    ivec2 cell = ivec2(floor(uv));
    vec2 centered = fract(uv) - 0.5;
    vec2 outerRadius = 0.35 * hash2.xy + 0.1;
    outerRadius *=
        float((cell.x & 1) ^ (cell.y & 1)) * 0.25 + 0.75;
    if (hash.z > 0.99) {
        outerRadius.x = outerRadius.y;
    }

    float borderThickness = 1.0 / 32.0;
    vec2 jitteredPosition =
        centered
        + (hash.xy * 2.0 - 1.0) * (0.5 - outerRadius);
    vec3 panelDistance;
    if (hash.z > 0.99) {
        panelDistance = stationPanelCircle(
            jitteredPosition,
            outerRadius.x - borderThickness
        );
    } else {
        panelDistance = stationPanelBox(
            jitteredPosition,
            outerRadius - borderThickness
        );
    }

    float filterWidth =
        max(fwidth(panelDistance.x), 1e-4);
    float distanceValue =
        smoothstep(
            -filterWidth,
            borderThickness + filterWidth,
            panelDistance.x
        );
    if (distanceValue <= 0.0 || distanceValue >= 1.0) {
        panelDistance.yz = vec2(0.0);
    }

    normal = normalize(vec3(panelDistance.yz, 1.0));
    return vec4(
        vec3(1.0) - distanceValue * 0.1,
        0.1 - distanceValue * 0.05
    );
}

vec4 stationTexPanelsDense(vec2 uv, out vec3 normal) {
    vec3 textureNormal = vec3(0.0);
    vec4 textureColor = vec4(0.0);
    float mask = 0.0;
    vec2 uvFootprint = fwidth(uv);
    float maximumFootprint =
        max(uvFootprint.x, uvFootprint.y);
    for (int layer = 0; layer < 9; ++layer) {
        vec3 layerNormal;
        float layerScale = float(layer + 1);
        vec4 layerColor = stationTexPanels(
            uv / layerScale + 37.5 * float(1 - layer),
            layerNormal
        );
        float layerFootprint =
            maximumFootprint / layerScale;
        float detailCoverage =
            1.0
            - smoothstep(0.35, 1.1, layerFootprint);
        layerColor =
            mix(
                vec4(vec3(0.95), 0.075),
                layerColor,
                detailCoverage
            );
        layerNormal =
            normalize(
                mix(
                    vec3(0.0, 0.0, 1.0),
                    layerNormal,
                    detailCoverage
                )
            );
        textureColor = mix(layerColor, textureColor, mask);
        textureNormal = mix(layerNormal, textureNormal, mask);
        mask = saturate((textureColor.a - 0.05) * 200.0);
    }

    normal = textureNormal;
    return textureColor;
}

void stationMatMin(
    inout float firstDistance,
    inout uint firstMaterial,
    float secondDistance,
    uint secondMaterial
) {
    if (firstDistance > secondDistance) {
        firstDistance = secondDistance;
        firstMaterial = secondMaterial;
    }
}

void stationMatMax(
    inout float firstDistance,
    inout uint firstMaterial,
    float secondDistance,
    uint secondMaterial
) {
    if (firstDistance < secondDistance) {
        firstDistance = secondDistance;
        firstMaterial = secondMaterial;
    }
}

float stationSdBox(vec3 point, vec3 radius) {
    vec3 distanceToEdge = abs(point) - radius;
    return min(
        max(distanceToEdge.x, max(distanceToEdge.y, distanceToEdge.z)),
        0.0
    ) + length(max(distanceToEdge, 0.0));
}

float stationCappedCylinder(vec3 point, float radius, float halfLength) {
    float distanceValue = length(point.xy) - radius;
    return max(distanceValue, abs(point.z) - halfLength);
}

float stationSdHexPrism(vec3 point, vec2 halfSize) {
    const vec3 coefficient = vec3(-0.8660254, 0.5, 0.57735);
    point = abs(point);
    point.xy -=
        2.0
        * min(dot(coefficient.xy, point.xy), 0.0)
        * coefficient.xy;
    vec2 distanceValue = vec2(
        length(
            point.xy
            - vec2(
                clamp(
                    point.x,
                    -coefficient.z * halfSize.x,
                    coefficient.z * halfSize.x
                ),
                halfSize.x
            )
        ) * sign(point.y - halfSize.x),
        point.z - halfSize.y
    );
    return min(max(distanceValue.x, distanceValue.y), 0.0)
        + length(max(distanceValue, 0.0));
}

float stationRepeat(float value, float period) {
    return mod(value, period) - 0.5 * period;
}

vec3 stationRepeatX(vec3 value, float period) {
    return vec3(
        mod(value.x, period) - 0.5 * period,
        value.yz
    );
}

vec2 stationRepeatX(vec2 value, float period) {
    return vec2(
        mod(value.x, period) - 0.5 * period,
        value.y
    );
}

vec3 stationRepeatY(vec3 value, float period) {
    return vec3(
        value.x,
        mod(value.y, period) - 0.5 * period,
        value.z
    );
}

vec3 stationRepeatZ(vec3 value, float period) {
    return vec3(
        value.xy,
        mod(value.z, period) - 0.5 * period
    );
}

vec3 stationFlipX(vec3 value, float radius) {
    return vec3(abs(value.x) - radius, value.yz);
}

vec3 stationFlipY(vec3 value, float radius) {
    return vec3(value.x, abs(value.y) - radius, value.z);
}

vec3 stationFlipZ(vec3 value, float radius) {
    return vec3(value.xy, abs(value.z) - radius);
}

vec2 stationFlipX(vec2 value, float radius) {
    return vec2(abs(value.x) - radius, value.y);
}

vec2 stationFlipY(vec2 value, float radius) {
    return vec2(value.x, abs(value.y) - radius);
}

float stationFlip(float value, float radius) {
    return abs(value) - radius;
}

float stationLength8(vec2 point) {
    point *= point;
    point *= point;
    point *= point;
    return pow(point.x + point.y, 1.0 / 8.0);
}

float stationLengthM(vec3 point) {
    float distanceValue =
        abs(point.x) + abs(point.y) + abs(point.z);
    return distanceValue * 0.5773;
}

float stationSdTorusHard(vec3 point, vec2 radii) {
    vec2 torusPoint = vec2(
        length(point.xz) - radii.x,
        point.y
    );
    return stationLength8(torusPoint) - radii.y;
}

float stationSdRoundBox(vec3 point, vec3 halfSize, float radius) {
    vec3 boxPoint = abs(point) - halfSize;
    return stationLengthM(max(boxPoint, 0.0))
        + min(max(boxPoint.x, max(boxPoint.y, boxPoint.z)), 0.0)
        - radius;
}

float stationTruss(
    vec3 point,
    float largeRailRadius,
    float smallRailRadius,
    float halfLength,
    float size
) {
    float bound = stationSdBox(
        point,
        vec3(size, size, halfLength) + largeRailRadius
    );
    if (bound > size * 0.5) {
        return bound;
    }

    float distanceValue = length(
        stationFlipY(
            stationFlipX(point.xy, size),
            size
        )
    ) - largeRailRadius;

    vec3 fourWay = vec3(
        max(abs(point.xy), abs(point.yx)) - size,
        stationRepeat(point.z, size * 2.0)
    );
    float secondDistance =
        length(fourWay.xz) - smallRailRadius;
    distanceValue = min(distanceValue, secondDistance);

    vec3 rotated = stationRotateX(point, PI * 0.25);
    rotated = stationFlipX(rotated, size);
    rotated.z += 1.414 * 0.5 * size;
    rotated = stationRepeatZ(rotated, 1.414 * size);
    secondDistance = length(rotated.xz) - smallRailRadius;
    secondDistance = max(
        secondDistance,
        stationFlip(point.y, size)
    );
    distanceValue = min(distanceValue, secondDistance);

    rotated = stationRotateY(point, PI * 0.25);
    rotated = stationFlipY(rotated, size);
    rotated.z += 1.414 * 0.5 * size;
    rotated = stationRepeatZ(rotated, 1.414 * size);
    secondDistance = length(rotated.yz) - smallRailRadius;
    secondDistance = max(
        secondDistance,
        stationFlip(point.x, size)
    );
    distanceValue = min(distanceValue, secondDistance);
    return max(
        distanceValue,
        stationFlip(point.z, halfLength)
    );
}

vec3 stationBandTransform(vec3 point) {
    float sphereRadius = max(length(point), 1e-8);
    float equatorialRadius = length(point.xz);
    float longitude =
        equatorialRadius > 1e-8
        ? atan(point.z, point.x)
        : 0.0;
    float latitude = asin(
        clamp(point.y / sphereRadius, -1.0, 1.0)
    );
    float foldedLatitude = abs(latitude);
    float innerBandOffset =
        foldedLatitude - STATION_INNER_BAND_LATITUDE;
    float outerBandOffset =
        foldedLatitude - STATION_OUTER_BAND_LATITUDE;
    float nearestBandOffset =
        abs(innerBandOffset) < abs(outerBandOffset)
        ? innerBandOffset
        : outerBandOffset;
    return vec3(
        26.0 * (longitude / PI),
        sphereRadius * nearestBandOffset,
        sphereRadius
    );
}

uint stationSetMatRgb(uint red, uint green, uint blue) {
    return STATION_MAT_RGB
        | (red << 24)
        | (green << 16)
        | (blue << 8);
}

bool stationIsMatRgb(uint material) {
    return (material & 0xffu) == STATION_MAT_RGB;
}

vec3 stationGetMatRgb(uint material) {
    return vec3(
        float((material >> 24) & 0xffu),
        float((material >> 16) & 0xffu),
        float((material >> 8) & 0xffu)
    );
}

void stationDish(vec3 point, out float distanceValue, out uint material) {
    float dishDistance = stationSdTorusHard(
        stationFlipY(point, 0.03),
        vec2(0.1, 0.01)
    );
    distanceValue = dishDistance;
    material = STATION_MAT_GLOSSY_ROUGH;

    dishDistance =
        length(point + vec3(0.32, 0.0, 0.0)) - 0.22;
    dishDistance = max(
        dishDistance,
        -(length(point + vec3(0.43, 0.0, 0.0)) - 0.25)
    );
    dishDistance = max(dishDistance, -point.x - 0.25);
    float secondDistance = length(point.yz) - 0.15;
    dishDistance = max(dishDistance, secondDistance) * 0.7;
    stationMatMin(
        distanceValue,
        material,
        dishDistance,
        stationSetMatRgb(90u, 90u, 90u)
    );

    vec3 rotated =
        stationRotateZ(point + vec3(0.37, 0.0, 0.0), PI * 0.25);
    dishDistance = length(rotated.xz) - 0.01;
    dishDistance = max(
        dishDistance,
        stationFlip(rotated.y + 0.107, 0.11)
    );
    stationMatMin(
        distanceValue,
        material,
        dishDistance,
        stationSetMatRgb(128u, 128u, 128u)
    );

    secondDistance = stationCappedCylinder(
        point.yzx + vec3(0.0, 0.0, 0.38),
        0.035,
        0.005
    );
    stationMatMin(
        distanceValue,
        material,
        secondDistance,
        STATION_MAT_GLOSSY_ROUGH
    );
}

void stationCityBlock(
    vec3 point,
    ivec2 integerCell,
    out float distanceValue,
    out uint material
) {
    vec4 randomValue = stationHashVec4I2(integerCell);
    vec4 randomValue2 = stationHashVec4I2(
        ivec2(randomValue.zw * 8192.0) + integerCell * 127
    );
    vec4 randomLarge = stationHashVec4I2(
        ivec2(integerCell.x >> 1, integerCell.y >> 3) + 1024
    );
    vec4 randomLarger = stationHashVec4I2(
        (integerCell >> 2) + 2048
    );

    float downtown = saturate(
        40.0
        / length(
            vec2(
                integerCell.x,
                ((integerCell.y + 50) % 100 - 50) * 8
            )
        )
    );

    if (randomLarger.w < 0.97) {
        if (randomLarge.w > 0.15) {
            float baseRadius =
                0.48 * max(0.1, 1.0 - randomValue.x);
            vec3 baseCenter = point - vec3(
                0.5
                    + (0.5 - baseRadius)
                    * (randomValue.y * 2.0 - 1.0)
                    * 0.7,
                0.0,
                0.5
                    + (0.5 - baseRadius)
                    * (randomValue.z * 2.0 - 1.0)
                    * 0.7
            );

            float height = randomValue.w * 0.5 + 0.1;
            height *= downtown * 1.8;
            height = floor(height * 20.0) * 0.05;
            float blockDistance = stationSdBox(
                baseCenter,
                vec3(baseRadius, height, baseRadius) - 0.02
            ) - 0.02;
            blockDistance = min(blockDistance, point.y);

            float secondHeight = randomValue.y * 0.3;
            secondHeight = floor(secondHeight * 20.0) * 0.05;
            randomValue2 = floor(randomValue2 * 20.0) * 0.05;

            blockDistance = min(
                blockDistance,
                stationSdBox(
                    baseCenter - vec3(0.0, height, 0.0),
                    vec3(
                        baseRadius,
                        secondHeight - randomValue2.y,
                        baseRadius * 0.4
                    ) - 0.02
                ) - 0.02
            );
            blockDistance = min(
                blockDistance,
                stationSdBox(
                    baseCenter - vec3(0.0, height, 0.0),
                    vec3(
                        baseRadius * 0.4,
                        secondHeight - randomValue2.x,
                        baseRadius
                    ) - 0.02
                ) - 0.02
            );

            if (randomValue2.y > 0.5) {
                blockDistance = min(
                    blockDistance,
                    stationSdBox(
                        baseCenter - vec3(0.0, height, 0.0),
                        vec3(
                            baseRadius
                                * 0.8
                                * (randomValue2.y + 0.1),
                            secondHeight,
                            baseRadius
                                * 0.8
                                * (randomValue2.z + 0.1)
                        )
                    )
                );
            } else if (randomValue2.z > 0.5) {
                blockDistance = min(
                    blockDistance,
                    stationSdHexPrism(
                        (
                            baseCenter
                            - vec3(0.0, height, 0.0)
                        ).xzy,
                        vec2(baseRadius * 0.7, secondHeight)
                    ) - 0.05
                );
            }

            distanceValue = blockDistance;
            material = STATION_MAT_FLOOR;
            vec3 litFactor = randomValue2.xxx * 0.8 + 0.2;
            litFactor += randomLarge.x * 0.25 - 0.15;
            litFactor -= randomLarger.x * 0.2 - 0.05;
            litFactor.z -= randomValue2.w * 0.05 - 0.025;
            litFactor += vec3(0.0, 0.025, 0.04);
            litFactor = max(vec3(0.05), litFactor);
            uvec3 packedColor =
                uvec3(
                    clamp(litFactor, vec3(0.0), vec3(1.0))
                    * 140.0
                );
            material = stationSetMatRgb(
                packedColor.x,
                packedColor.y,
                packedColor.z
            );
            if (point.y < 0.01) {
                material = STATION_MAT_FLOOR;
            }

            if (randomValue2.w < 0.25) {
                float detailDistance = stationSdRoundBox(
                    (
                        baseCenter
                        - vec3(0.0, height, 0.0)
                    ).xzy,
                    vec3(baseRadius)
                        * randomValue.xyz
                        * 0.5,
                    baseRadius * 0.45 * randomValue.w
                );
                stationMatMin(
                    distanceValue,
                    material,
                    detailDistance,
                    STATION_MAT_BORING
                );
            }
        } else {
            point.xz += vec2(
                integerCell.x & 0x1,
                (integerCell.y & 0x7) - 3
            );
            distanceValue = point.y;
            material = STATION_MAT_FLOOR;
            vec3 baseCenter =
                point - vec3(1.0, 0.0, 1.0);

            float blockDistance = stationSdBox(
                abs(baseCenter) - vec3(0.5, 0.0, 0.0),
                vec3(0.3, 0.1, 3.3)
            ) - 0.1;
            stationMatMax(
                distanceValue,
                material,
                -blockDistance,
                stationSetMatRgb(50u, 51u, 53u)
            );

            blockDistance = stationSdBox(
                baseCenter
                    - vec3(
                        0.5,
                        0.0,
                        (randomLarge.z - 0.5) * 4.0
                    ),
                vec3(
                    0.5 * randomLarge.x,
                    0.74,
                    2.0 * randomLarge.y
                )
            );
            stationMatMax(
                distanceValue,
                material,
                -blockDistance,
                STATION_NICE_COLORS[
                    int(randomLarge.x * 3.99)
                ]
            );

            blockDistance = stationSdBox(
                baseCenter
                    - vec3(
                        -0.5,
                        0.0,
                        (randomLarge.w - 0.5) * 4.0
                    ),
                vec3(
                    0.5 * randomLarge.y,
                    0.74,
                    2.0 * randomLarge.x
                )
            );
            stationMatMax(
                distanceValue,
                material,
                -blockDistance,
                STATION_NICE_COLORS[
                    int(randomLarge.y * 3.99)
                ]
            );
        }
    } else {
        point.xz += vec2(integerCell & 0x3);
        distanceValue = point.y;
        material = STATION_MAT_FLOOR;
        vec3 baseCenter = point - vec3(
            2.0,
            0.5 * randomLarger.y,
            2.0
        );
        float roofWave = min(
            0.015,
            abs(
                (
                    sin(point.x * 4.0)
                    + sin(point.z * 16.0)
                ) * 0.015
            )
        );
        float secondDistance = stationSdRoundBox(
            baseCenter * vec3(1.0, 1.0 - roofWave, 1.0)
                + vec3(0.0, 0.75, 0.0),
            vec3(1.1 - randomLarger.w * 0.2),
            0.65 - randomLarger.x * 0.3
        );
        float domeDistance = stationSdRoundBox(
            stationRotateY(baseCenter, 0.785)
                    * vec3(1.0, 1.0 - roofWave, 1.0)
                + vec3(0.0, 0.75, 0.0),
            vec3(1.1 - randomLarger.w * 0.2),
            0.65 - randomLarger.x * 0.3
        );
        domeDistance = min(domeDistance, secondDistance);
        domeDistance *= 1.25;
        uint domeMaterial = STATION_MAT_DOME;
        if (point.y < 0.2) {
            domeMaterial = stationSetMatRgb(60u, 112u, 120u);
        }
        stationMatMin(
            distanceValue,
            material,
            domeDistance,
            domeMaterial
        );
    }

    vec3 repeatedPoint = point - vec3(0.0, 0.1, 0.5);
    repeatedPoint.x = stationRepeat(repeatedPoint.x, 0.5);
    float pipeDistance =
        length(repeatedPoint.xy) - 0.0625 * randomValue2.x;
    if (randomValue.z > 0.7) {
        stationMatMin(
            distanceValue,
            material,
            pipeDistance,
            STATION_MAT_PIPE
        );
    }

    repeatedPoint =
        point - vec3(0.0, 0.13 * randomValue.z, 0.5);
    repeatedPoint.z = stationRepeat(repeatedPoint.z, 0.5);
    pipeDistance = length(repeatedPoint.yz) - 0.025;
    if (randomLarger.y > 0.6) {
        stationMatMin(
            distanceValue,
            material,
            pipeDistance,
            STATION_MAT_WALL
        );

        repeatedPoint =
            point - vec3(0.0, 0.5 * randomValue2.z, 0.5);
        repeatedPoint.x =
            stationRepeat(repeatedPoint.x, 1.0);
        pipeDistance = length(repeatedPoint.xy) - 0.05;
        if (randomLarge.y > 0.5) {
            uint pipeMaterial = STATION_MAT_PIPE;
            if (randomLarge.x > 0.95) {
                pipeMaterial = STATION_MAT_YELLOW;
            }
            stationMatMin(
                distanceValue,
                material,
                pipeDistance,
                pipeMaterial
            );
        }
    }
}

void stationDistanceToObjectSource(
    vec3 point,
    out float distanceValue,
    out uint material
) {
    point = stationRotatingSourcePoint(point);

    float density = 8.0;
    vec3 bandCoordinates = stationBandTransform(point);
    vec3 cylindrical = bandCoordinates;
    cylindrical.x *= density;

    const float scale = 1.0;
    float scaleDenominator = scale / density;
    cylindrical = cylindrical.yzx / scaleDenominator;
    cylindrical.z *= scaleDenominator;
    cylindrical.y -= 8.0 * density;
    cylindrical.y = abs(cylindrical.y) - 1.0;

    vec3 repeated = cylindrical;
    repeated.xz = fract(cylindrical.xz);
    float temporaryDistance;
    uint temporaryMaterial;
    stationCityBlock(
        repeated,
        ivec2(floor(cylindrical.xz)),
        temporaryDistance,
        temporaryMaterial
    );
    temporaryDistance *= scaleDenominator;
    distanceValue = -100000000.0;
    material = 0u;
    stationMatMax(
        distanceValue,
        material,
        temporaryDistance,
        temporaryMaterial
    );

    stationMatMax(
        distanceValue,
        material,
        abs(bandCoordinates.y) - STATION_BAND_HALF_ARC,
        STATION_MAT_SIDE_WINDOWS
    );

    float ringRadius = 0.05;
    float geometryDistance =
        length(abs(cylindrical.xy) + vec2(-8.0, 0.0))
        - ringRadius;
    geometryDistance *= scaleDenominator;
    stationMatMin(
        distanceValue,
        material,
        geometryDistance,
        STATION_MAT_YELLOW
    );

    geometryDistance =
        length(
            vec2(abs(cylindrical.x), cylindrical.y)
            + vec2(-8.0, 1.0)
        ) - ringRadius;
    geometryDistance *= scaleDenominator;
    stationMatMin(
        distanceValue,
        material,
        geometryDistance,
        STATION_MAT_SPOKE
    );
}

void stationScene(
    vec3 worldPoint,
    out float worldDistance,
    out uint material
) {
    float sourceDistance;
    stationDistanceToObjectSource(
        worldPoint / STATION_SCALE,
        sourceDistance,
        material
    );
    worldDistance = sourceDistance * STATION_SCALE;
}

float stationDistanceOnly(vec3 worldPoint) {
    float worldDistance;
    uint material;
    stationScene(worldPoint, worldDistance, material);
    return worldDistance;
}
