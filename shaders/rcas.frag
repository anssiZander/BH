#version 300 es

precision highp float;
precision highp sampler2D;

in vec2 vScreen;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uSharpness;

float rcasLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 inverseResolution =
        1.0 / max(uResolution, vec2(1.0));
    vec2 uv = vScreen * 0.5 + 0.5;

    vec4 centerSample = texture(uSource, uv);
    if (uSharpness <= 0.0) {
        outColor = centerSample;
        return;
    }

    vec3 north =
        texture(
            uSource,
            uv + vec2(0.0, 1.0) * inverseResolution
        ).rgb;
    vec3 west =
        texture(
            uSource,
            uv + vec2(-1.0, 0.0) * inverseResolution
        ).rgb;
    vec3 east =
        texture(
            uSource,
            uv + vec2(1.0, 0.0) * inverseResolution
        ).rgb;
    vec3 south =
        texture(
            uSource,
            uv + vec2(0.0, -1.0) * inverseResolution
        ).rgb;

    vec3 neighborhoodMinimum =
        min(min(north, south), min(west, east));
    vec3 neighborhoodMaximum =
        max(max(north, south), max(west, east));

    vec3 hitMinimum =
        neighborhoodMinimum
        / max(neighborhoodMaximum * 4.0, vec3(1e-4));
    vec3 hitMaximum =
        (vec3(1.0) - neighborhoodMaximum)
        / min(
            4.0 * (neighborhoodMinimum - vec3(1.0)),
            vec3(-1e-4)
        );
    vec3 channelLobe = max(-hitMinimum, hitMaximum);
    float lobe =
        max(
            -0.1875,
            min(
                0.0,
                max(
                    channelLobe.r,
                    max(channelLobe.g, channelLobe.b)
                )
            )
        );

    vec3 neighborAverage =
        0.25 * (north + west + east + south);
    float localRange =
        max(
            rcasLuminance(neighborhoodMaximum)
            - rcasLuminance(neighborhoodMinimum),
            1e-3
        );
    float noiseEstimate =
        abs(
            rcasLuminance(centerSample.rgb)
            - rcasLuminance(neighborAverage)
        ) / localRange;
    float noiseAttenuation =
        1.0 - 0.5 * clamp(noiseEstimate, 0.0, 1.0);

    lobe *=
        clamp(uSharpness, 0.0, 1.0)
        * noiseAttenuation;
    vec3 sharpened =
        (
            centerSample.rgb
            + lobe * (north + west + east + south)
        ) / max(1.0 + 4.0 * lobe, 0.25);

    outColor = vec4(
        clamp(sharpened, 0.0, 1.0),
        centerSample.a
    );
}
