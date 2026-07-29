#version 300 es

precision highp float;
precision highp sampler2D;

in vec2 vScreen;
out vec4 outColor;

uniform sampler2D uCurrentFrame;
uniform sampler2D uHistoryFrame;
uniform sampler2D uMotionFrame;
uniform vec2 uResolution;
uniform bool uHistoryValid;
uniform float uHistoryBlend;

float spatialLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

vec4 resolveCurrentEdge(vec2 uv, vec4 centerSample) {
    vec2 inverseResolution =
        1.0 / max(uResolution, vec2(1.0));
    vec3 northWest =
        texture(
            uCurrentFrame,
            uv + vec2(-1.0, 1.0) * inverseResolution
        ).rgb;
    vec3 northEast =
        texture(
            uCurrentFrame,
            uv + vec2(1.0, 1.0) * inverseResolution
        ).rgb;
    vec3 southWest =
        texture(
            uCurrentFrame,
            uv + vec2(-1.0, -1.0) * inverseResolution
        ).rgb;
    vec3 southEast =
        texture(
            uCurrentFrame,
            uv + vec2(1.0, -1.0) * inverseResolution
        ).rgb;

    float lumaCenter = spatialLuminance(centerSample.rgb);
    float lumaNorthWest = spatialLuminance(northWest);
    float lumaNorthEast = spatialLuminance(northEast);
    float lumaSouthWest = spatialLuminance(southWest);
    float lumaSouthEast = spatialLuminance(southEast);
    float lumaMinimum =
        min(
            lumaCenter,
            min(
                min(lumaNorthWest, lumaNorthEast),
                min(lumaSouthWest, lumaSouthEast)
            )
        );
    float lumaMaximum =
        max(
            lumaCenter,
            max(
                max(lumaNorthWest, lumaNorthEast),
                max(lumaSouthWest, lumaSouthEast)
            )
        );
    float lumaRange = lumaMaximum - lumaMinimum;
    if (
        lumaRange
        < max(0.0312, lumaMaximum * 0.125)
    ) return centerSample;

    vec2 direction = vec2(
        -(
            (lumaNorthWest + lumaNorthEast)
            - (lumaSouthWest + lumaSouthEast)
        ),
        (lumaNorthWest + lumaSouthWest)
            - (lumaNorthEast + lumaSouthEast)
    );
    float directionReduction =
        max(
            (
                lumaNorthWest
                + lumaNorthEast
                + lumaSouthWest
                + lumaSouthEast
            ) * (0.25 * 0.125),
            1.0 / 128.0
        );
    float reciprocalDirection =
        1.0
        / (
            min(abs(direction.x), abs(direction.y))
            + directionReduction
        );
    direction =
        clamp(
            direction * reciprocalDirection,
            vec2(-8.0),
            vec2(8.0)
        ) * inverseResolution;

    vec3 inner =
        0.5
        * (
            texture(
                uCurrentFrame,
                uv + direction * (1.0 / 3.0 - 0.5)
            ).rgb
            + texture(
                uCurrentFrame,
                uv + direction * (2.0 / 3.0 - 0.5)
            ).rgb
        );
    vec3 outer =
        inner * 0.5
        + 0.25
        * (
            texture(
                uCurrentFrame,
                uv - direction * 0.5
            ).rgb
            + texture(
                uCurrentFrame,
                uv + direction * 0.5
            ).rgb
        );
    float lumaOuter = spatialLuminance(outer);
    vec3 filtered =
        lumaOuter < lumaMinimum || lumaOuter > lumaMaximum
        ? inner
        : outer;
    return vec4(filtered, centerSample.a);
}

/*
 * Motion is an absolute previous-frame UV packed into RGBA8:
 *
 *   R = previousU high byte, G = previousU low byte
 *   B = previousV high byte, A = previousV low byte
 *
 * RGBA = 0xff marks an invalid history sample. Valid motion writers must
 * therefore reserve 0xffffffff rather than use it for the (1, 1) endpoint.
 */
bool decodePreviousUv(vec4 encodedMotion, out vec2 previousUv) {
    uvec4 bytes =
        uvec4(
            floor(
                clamp(encodedMotion, 0.0, 1.0) * 255.0
                + 0.5
            )
        );
    if (all(equal(bytes, uvec4(255u)))) {
        previousUv = vec2(0.0);
        return false;
    }

    uint packedU = (bytes.r << 8u) | bytes.g;
    uint packedV = (bytes.b << 8u) | bytes.a;
    previousUv =
        vec2(float(packedU), float(packedV)) * (1.0 / 65535.0);
    return true;
}

vec4 historyTap(
    sampler2D source,
    vec2 texelPosition,
    vec2 inverseSize
) {
    vec2 halfTexel = 0.5 * inverseSize;
    vec2 uv =
        clamp(
            (texelPosition + 0.5) * inverseSize,
            halfTexel,
            vec2(1.0) - halfTexel
        );
    return texture(source, uv);
}

/*
 * Nine bilinear taps evaluate a separable Catmull-Rom reconstruction.
 * Combining the two positive middle lobes preserves the full cubic kernel
 * while keeping the temporal resolve inexpensive.
 */
vec4 sampleHistoryCatmullRom(vec2 uv) {
    vec2 sourceSize = vec2(textureSize(uHistoryFrame, 0));
    vec2 inverseSize = 1.0 / max(sourceSize, vec2(1.0));
    vec2 samplePosition = uv * sourceSize - 0.5;
    vec2 texelPosition1 = floor(samplePosition);
    vec2 fractionValue = fract(samplePosition);

    vec2 weight0 =
        fractionValue
        * (
            -0.5
            + fractionValue
            * (1.0 - 0.5 * fractionValue)
        );
    vec2 weight1 =
        1.0
        + fractionValue
        * fractionValue
        * (-2.5 + 1.5 * fractionValue);
    vec2 weight2 =
        fractionValue
        * (
            0.5
            + fractionValue
            * (2.0 - 1.5 * fractionValue)
        );
    vec2 weight3 =
        fractionValue
        * fractionValue
        * (-0.5 + 0.5 * fractionValue);

    vec2 middleWeight = weight1 + weight2;
    vec2 middleOffset =
        weight2 / max(middleWeight, vec2(1e-6));
    vec2 texelPosition0 = texelPosition1 - 1.0;
    vec2 texelPosition12 = texelPosition1 + middleOffset;
    vec2 texelPosition3 = texelPosition1 + 2.0;

    vec4 row0 =
        historyTap(
            uHistoryFrame,
            vec2(texelPosition0.x, texelPosition0.y),
            inverseSize
        ) * weight0.x
        + historyTap(
            uHistoryFrame,
            vec2(texelPosition12.x, texelPosition0.y),
            inverseSize
        ) * middleWeight.x
        + historyTap(
            uHistoryFrame,
            vec2(texelPosition3.x, texelPosition0.y),
            inverseSize
        ) * weight3.x;
    vec4 row12 =
        historyTap(
            uHistoryFrame,
            vec2(texelPosition0.x, texelPosition12.y),
            inverseSize
        ) * weight0.x
        + historyTap(
            uHistoryFrame,
            vec2(texelPosition12.x, texelPosition12.y),
            inverseSize
        ) * middleWeight.x
        + historyTap(
            uHistoryFrame,
            vec2(texelPosition3.x, texelPosition12.y),
            inverseSize
        ) * weight3.x;
    vec4 row3 =
        historyTap(
            uHistoryFrame,
            vec2(texelPosition0.x, texelPosition3.y),
            inverseSize
        ) * weight0.x
        + historyTap(
            uHistoryFrame,
            vec2(texelPosition12.x, texelPosition3.y),
            inverseSize
        ) * middleWeight.x
        + historyTap(
            uHistoryFrame,
            vec2(texelPosition3.x, texelPosition3.y),
            inverseSize
        ) * weight3.x;

    return
        row0 * weight0.y
        + row12 * middleWeight.y
        + row3 * weight3.y;
}

vec3 rgbToYCoCg(vec3 color) {
    return vec3(
        color.r * 0.25 + color.g * 0.5 + color.b * 0.25,
        color.r * 0.5 - color.b * 0.5,
        color.g * 0.5 - color.r * 0.25 - color.b * 0.25
    );
}

vec3 yCoCgToRgb(vec3 color) {
    return vec3(
        color.x + color.y - color.z,
        color.x + color.z,
        color.x - color.y - color.z
    );
}

vec3 clipToAabb(
    vec3 historyColor,
    vec3 boxMinimum,
    vec3 boxMaximum
) {
    vec3 boxCenter = 0.5 * (boxMinimum + boxMaximum);
    vec3 boxExtent =
        max(0.5 * (boxMaximum - boxMinimum), vec3(1e-5));
    vec3 offset = historyColor - boxCenter;
    vec3 normalizedOffset = abs(offset) / boxExtent;
    float maximumComponent =
        max(
            normalizedOffset.x,
            max(normalizedOffset.y, normalizedOffset.z)
        );
    return maximumComponent > 1.0
        ? boxCenter + offset / maximumComponent
        : historyColor;
}

void main() {
    vec2 resolution = max(uResolution, vec2(1.0));
    ivec2 textureExtent = textureSize(uCurrentFrame, 0);
    ivec2 maximumPixel = max(textureExtent - ivec2(1), ivec2(0));
    vec2 currentUv = vScreen * 0.5 + 0.5;
    ivec2 pixel =
        clamp(
            ivec2(floor(currentUv * vec2(textureExtent))),
            ivec2(0),
            maximumPixel
        );

    vec4 currentCenter = texelFetch(uCurrentFrame, pixel, 0);
    vec4 spatialCurrent =
        resolveCurrentEdge(currentUv, currentCenter);
    if (!uHistoryValid || uHistoryBlend <= 0.0) {
        outColor = spatialCurrent;
        return;
    }

    vec2 previousUv;
    vec4 encodedMotion = texelFetch(uMotionFrame, pixel, 0);
    bool historyValid =
        decodePreviousUv(encodedMotion, previousUv)
        && all(greaterThanEqual(previousUv, vec2(0.0)))
        && all(lessThanEqual(previousUv, vec2(1.0)));
    if (!historyValid) {
        outColor = spatialCurrent;
        return;
    }

    ivec2 northPixel =
        clamp(pixel + ivec2(0, 1), ivec2(0), maximumPixel);
    ivec2 southPixel =
        clamp(pixel + ivec2(0, -1), ivec2(0), maximumPixel);
    ivec2 eastPixel =
        clamp(pixel + ivec2(1, 0), ivec2(0), maximumPixel);
    ivec2 westPixel =
        clamp(pixel + ivec2(-1, 0), ivec2(0), maximumPixel);

    vec3 currentSamples[5] = vec3[](
        rgbToYCoCg(currentCenter.rgb),
        rgbToYCoCg(texelFetch(uCurrentFrame, northPixel, 0).rgb),
        rgbToYCoCg(texelFetch(uCurrentFrame, southPixel, 0).rgb),
        rgbToYCoCg(texelFetch(uCurrentFrame, eastPixel, 0).rgb),
        rgbToYCoCg(texelFetch(uCurrentFrame, westPixel, 0).rgb)
    );

    vec3 neighborhoodMinimum = currentSamples[0];
    vec3 neighborhoodMaximum = currentSamples[0];
    vec3 neighborhoodMean = vec3(0.0);
    vec3 neighborhoodSecondMoment = vec3(0.0);
    for (int sampleIndex = 0; sampleIndex < 5; ++sampleIndex) {
        vec3 sampleColor = currentSamples[sampleIndex];
        neighborhoodMinimum =
            min(neighborhoodMinimum, sampleColor);
        neighborhoodMaximum =
            max(neighborhoodMaximum, sampleColor);
        neighborhoodMean += sampleColor;
        neighborhoodSecondMoment += sampleColor * sampleColor;
    }
    neighborhoodMean *= 0.2;
    neighborhoodSecondMoment *= 0.2;
    vec3 neighborhoodVariance =
        max(
            neighborhoodSecondMoment
            - neighborhoodMean * neighborhoodMean,
            vec3(0.0)
        );
    vec3 neighborhoodSigma = sqrt(neighborhoodVariance);

    vec3 varianceMinimum =
        neighborhoodMean - neighborhoodSigma * 1.35;
    vec3 varianceMaximum =
        neighborhoodMean + neighborhoodSigma * 1.35;
    vec3 clipMinimum =
        max(neighborhoodMinimum, varianceMinimum);
    vec3 clipMaximum =
        min(neighborhoodMaximum, varianceMaximum);

    vec4 historySample =
        clamp(
            sampleHistoryCatmullRom(previousUv),
            0.0,
            1.0
        );
    vec3 historyColor =
        rgbToYCoCg(historySample.rgb);
    vec3 clippedHistory =
        clipToAabb(
            historyColor,
            clipMinimum,
            clipMaximum
        );

    vec3 currentColor = currentSamples[0];
    float lumaMismatch =
        abs(historyColor.x - currentColor.x)
        / max(neighborhoodSigma.x + 0.018, 0.018);
    float chromaMismatch =
        length(historyColor.yz - currentColor.yz)
        / max(
            length(neighborhoodSigma.yz) + 0.024,
            0.024
        );
    float clipDistance =
        length(historyColor - clippedHistory)
        / max(
            length(clipMaximum - clipMinimum) + 0.025,
            0.025
        );

    float rejection =
        max(
            smoothstep(1.25, 4.0, lumaMismatch),
            smoothstep(1.5, 4.5, chromaMismatch)
        );
    rejection =
        max(
            rejection,
            smoothstep(0.08, 0.55, clipDistance)
        );
    ivec2 historyExtent =
        textureSize(uHistoryFrame, 0);
    ivec2 historyPixel =
        clamp(
            ivec2(
                floor(
                    previousUv
                    * vec2(historyExtent)
                )
            ),
            ivec2(0),
            max(
                historyExtent - ivec2(1),
                ivec2(0)
            )
        );
    float previousDepth =
        texelFetch(
            uHistoryFrame,
            historyPixel,
            0
        ).a;
    float depthMismatch =
        abs(previousDepth - currentCenter.a);
    rejection =
        max(
            rejection,
            smoothstep(0.006, 0.045, depthMismatch)
        );

    float motionInPixels =
        length((previousUv - currentUv) * resolution);
    float rapidMotionRejection =
        smoothstep(12.0, 48.0, motionInPixels);
    rejection = max(rejection, rapidMotionRejection);

    float baseHistoryWeight =
        min(clamp(uHistoryBlend, 0.0, 1.0), 0.92);
    float historyWeight =
        baseHistoryWeight * (1.0 - rejection);
    vec3 resolvedColor =
        mix(
            rgbToYCoCg(spatialCurrent.rgb),
            clippedHistory,
            historyWeight
        );

    outColor = vec4(
        clamp(yCoCgToRgb(resolvedColor), 0.0, 1.0),
        currentCenter.a
    );
}
