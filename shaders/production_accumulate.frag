#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) out vec4 outAverage;

uniform sampler2D uCurrentSample;
uniform sampler2D uPreviousAverage;
uniform int uSampleIndex;

void main() {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    vec3 current = texelFetch(uCurrentSample, pixel, 0).rgb;
    if (uSampleIndex == 0) {
        outAverage = vec4(current, 1.0);
        return;
    }
    vec3 previous = texelFetch(uPreviousAverage, pixel, 0).rgb;
    float count = float(uSampleIndex + 1);
    outAverage = vec4(previous + (current - previous) / count, 1.0);
}
