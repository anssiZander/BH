#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) out vec4 outColor;

uniform sampler2D uLinearAverage;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uSaturation;
uniform float uSharpness;

vec3 linearToSrgb(vec3 linearColor) {
    vec3 low = linearColor * 12.92;
    vec3 high = 1.055 * pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, lessThanEqual(linearColor, vec3(0.0031308)));
}

vec3 displayTransform(vec3 linearColor) {
    linearColor = max(linearColor, vec3(0.0));
    float luminance = dot(linearColor, vec3(0.2126, 0.7152, 0.0722));
    linearColor = mix(vec3(luminance), linearColor, uSaturation);
    vec3 mapped = vec3(1.0) - exp(-max(linearColor, vec3(0.0)) * uExposure);
    return linearToSrgb(max(mapped, vec3(0.0)));
}

uint hashPixel(uvec2 pixel) {
    uint value = pixel.x * 0x1f123bb5u ^ pixel.y * 0x5f356495u ^ 0x9e3779b9u;
    value ^= value >> 16;
    value *= 0x7feb352du;
    value ^= value >> 15;
    value *= 0x846ca68bu;
    return value ^ (value >> 16);
}

float signedDither(ivec2 pixel) {
    uint bits = hashPixel(uvec2(pixel));
    float first = float(bits & 65535u) / 65535.0;
    float second = float(bits >> 16) / 65535.0;
    return (first - second) * (0.5 / 255.0);
}

void main() {
    ivec2 size = ivec2(uResolution);
    ivec2 pixel = clamp(ivec2(gl_FragCoord.xy), ivec2(0), size - 1);
    ivec2 leftPixel = ivec2(max(pixel.x - 1, 0), pixel.y);
    ivec2 rightPixel = ivec2(min(pixel.x + 1, size.x - 1), pixel.y);
    ivec2 downPixel = ivec2(pixel.x, max(pixel.y - 1, 0));
    ivec2 upPixel = ivec2(pixel.x, min(pixel.y + 1, size.y - 1));

    vec3 center = displayTransform(texelFetch(uLinearAverage, pixel, 0).rgb);
    vec3 neighbors = (
        displayTransform(texelFetch(uLinearAverage, leftPixel, 0).rgb)
        + displayTransform(texelFetch(uLinearAverage, rightPixel, 0).rgb)
        + displayTransform(texelFetch(uLinearAverage, downPixel, 0).rgb)
        + displayTransform(texelFetch(uLinearAverage, upPixel, 0).rgb)
    ) * 0.25;
    float localRange = max(
        max(max(abs(center.r - neighbors.r), abs(center.g - neighbors.g)), abs(center.b - neighbors.b)),
        0.0
    );
    float luma = dot(center, vec3(0.2126, 0.7152, 0.0722));
    float restraint = smoothstep(0.002, 0.035, luma) * (1.0 - smoothstep(0.12, 0.45, localRange));
    vec3 sharpened = clamp(center + (center - neighbors) * uSharpness * restraint, 0.0, 1.0);
    if (all(lessThanEqual(sharpened, vec3(0.0)))) {
        outColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    outColor = vec4(clamp(sharpened + signedDither(pixel), 0.0, 1.0), 1.0);
}
