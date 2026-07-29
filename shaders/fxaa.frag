#version 300 es

precision highp float;
precision highp sampler2D;

in vec2 vScreen;
out vec4 outColor;

uniform sampler2D uScene;
uniform sampler2D uHistory;
uniform vec2 uResolution;
uniform bool uHistoryValid;
uniform float uHistoryBlend;

float fxaaLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = vScreen * 0.5 + 0.5;
    vec2 inverseResolution = 1.0 / max(uResolution, vec2(1.0));

    vec3 colorCenter = texture(uScene, uv).rgb;
    float lumaCenter = fxaaLuminance(colorCenter);
    float lumaNorthWest =
        fxaaLuminance(
            texture(
                uScene,
                uv + vec2(-1.0, 1.0) * inverseResolution
            ).rgb
        );
    float lumaNorthEast =
        fxaaLuminance(
            texture(
                uScene,
                uv + vec2(1.0, 1.0) * inverseResolution
            ).rgb
        );
    float lumaSouthWest =
        fxaaLuminance(
            texture(
                uScene,
                uv + vec2(-1.0, -1.0) * inverseResolution
            ).rgb
        );
    float lumaSouthEast =
        fxaaLuminance(
            texture(
                uScene,
                uv + vec2(1.0, -1.0) * inverseResolution
            ).rgb
        );

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
    vec3 filteredColor = colorCenter;
    if (
        lumaRange
        >= max(0.0312, lumaMaximum * 0.125)
    ) {
        vec2 direction;
        direction.x =
            -(
                (lumaNorthWest + lumaNorthEast)
                - (lumaSouthWest + lumaSouthEast)
            );
        direction.y =
            (lumaNorthWest + lumaSouthWest)
            - (lumaNorthEast + lumaSouthEast);

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

        vec3 colorInner =
            0.5
            * (
                texture(
                    uScene,
                    uv + direction * (1.0 / 3.0 - 0.5)
                ).rgb
                + texture(
                    uScene,
                    uv + direction * (2.0 / 3.0 - 0.5)
                ).rgb
            );
        vec3 colorOuter =
            colorInner * 0.5
            + 0.25
            * (
                texture(uScene, uv + direction * -0.5).rgb
                + texture(uScene, uv + direction * 0.5).rgb
            );
        float lumaOuter = fxaaLuminance(colorOuter);
        filteredColor =
            lumaOuter < lumaMinimum || lumaOuter > lumaMaximum
            ? colorInner
            : colorOuter;
    }

    if (uHistoryValid) {
        vec3 colorNorth =
            texture(
                uScene,
                uv + vec2(0.0, 1.0) * inverseResolution
            ).rgb;
        vec3 colorSouth =
            texture(
                uScene,
                uv + vec2(0.0, -1.0) * inverseResolution
            ).rgb;
        vec3 colorEast =
            texture(
                uScene,
                uv + vec2(1.0, 0.0) * inverseResolution
            ).rgb;
        vec3 colorWest =
            texture(
                uScene,
                uv + vec2(-1.0, 0.0) * inverseResolution
            ).rgb;
        vec3 neighborhoodMinimum =
            min(
                filteredColor,
                min(
                    min(colorNorth, colorSouth),
                    min(colorEast, colorWest)
                )
            );
        vec3 neighborhoodMaximum =
            max(
                filteredColor,
                max(
                    max(colorNorth, colorSouth),
                    max(colorEast, colorWest)
                )
            );
        vec3 historyColor =
            clamp(
                texture(uHistory, uv).rgb,
                neighborhoodMinimum,
                neighborhoodMaximum
            );
        float historyLuma = fxaaLuminance(historyColor);
        float filteredLuma = fxaaLuminance(filteredColor);
        float relativeLumaChange =
            abs(historyLuma - filteredLuma)
            / max(max(historyLuma, filteredLuma), 0.08);
        vec3 relativeColorChange =
            abs(historyColor - filteredColor)
            / max(
                max(historyColor, filteredColor),
                vec3(0.08)
            );
        float maximumRelativeColorChange =
            max(
                relativeColorChange.r,
                max(
                    relativeColorChange.g,
                    relativeColorChange.b
                )
            );
        float reactiveRejection =
            smoothstep(0.06, 0.32, relativeLumaChange);
        reactiveRejection =
            max(
                reactiveRejection,
                smoothstep(
                    0.08,
                    0.35,
                    maximumRelativeColorChange
                )
            );
        float temporalWeight =
            uHistoryBlend * (1.0 - reactiveRejection);
        filteredColor =
            mix(filteredColor, historyColor, temporalWeight);
    }

    outColor = vec4(filteredColor, 1.0);
}
