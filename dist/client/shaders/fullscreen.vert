#version 300 es

precision highp float;
precision highp int;

out vec2 vScreen;

void main() {
    vec2 position = vec2(
        (gl_VertexID << 1) & 2,
        gl_VertexID & 2
    );
    vScreen = position * 2.0 - 1.0;
    gl_Position = vec4(vScreen, 0.0, 1.0);
}
