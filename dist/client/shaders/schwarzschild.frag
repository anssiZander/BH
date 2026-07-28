#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 vScreen;
out vec4 outColor;

uniform vec2 uResolution;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uFovY;
uniform int uMaxSteps;
uniform float uBaseStep;
uniform bool uLensing;
uniform bool uGridVisible;
uniform bool uSpheresVisible;
uniform bool uSkyVisible;
uniform bool uTracksVisible;
uniform float uGridBrightness;
uniform int uShellCount;
uniform float uExposure;
uniform float uSaturation;
uniform sampler2D uSky;

const float PI = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;
const float M = 1.0;
const float CAPTURE_RHO = 0.515;
const float PHOTON_RHO = 1.8660254037844386;
const float CRITICAL_IMPACT = 5.196152422706632;
const float ESCAPE_RHO = 36.0;
const int HARD_MAX_STEPS = 896;
const int SHELL_COUNT = 8;
const int TRACK_COUNT = 15;

const float SHELL_RADII[SHELL_COUNT] = float[](
    0.93166248, 1.30901699, 1.86602540, 2.39564392,
    2.91421356, 3.93649167, 5.45416346, 6.96410162
);

const float TRACK_RADII[TRACK_COUNT] = float[](
    0.72000000, 0.93166248, 1.12000000, 1.30901699, 1.58000000,
    1.86602540, 2.18000000, 2.39564392, 2.91421356, 3.42000000,
    3.93649167, 4.75000000, 5.45416346, 6.25000000, 6.96410162
);

float saturate(float value) {
    return clamp(value, 0.0, 1.0);
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

float adaptiveStep(float rho) {
    float interpolation = smoothstep(1.2, 18.0, rho);
    float rayStep = uBaseStep * mix(0.35, 6.0, interpolation);

    // The unstable photon orbit needs a stricter cap than ordinary shell events.
    float photonBlend = smoothstep(0.0, 0.28, abs(rho - PHOTON_RHO));
    rayStep = min(rayStep, mix(0.016, rayStep, photonBlend));

    // Only visible grid shells incur crossing refinement.
    if ((uGridVisible || uSpheresVisible) && rho > 0.64 && rho < 7.30) {
        for (int shell = 0; shell < SHELL_COUNT; ++shell) {
            if (shell >= uShellCount) break;
            float distanceToShell = abs(rho - SHELL_RADII[shell]);
            float shellBlend = smoothstep(0.0, 0.28, distanceToShell);
            rayStep = min(rayStep, mix(0.075, rayStep, shellBlend));
        }
    }
    return rayStep;
}

vec2 gridPipe(vec3 point, int shellIndex) {
    vec3 normal = normalize(point);
    float latitude = asin(clamp(normal.y, -1.0, 1.0));
    float longitude = atan(normal.z, normal.x);

    float latitudeCells = shellIndex == 2 ? 16.0 : 12.0;
    float longitudeCells = shellIndex == 2 ? 32.0 : 24.0;
    float latitudeOffset =
        fract((latitude / PI + 0.5) * latitudeCells + 0.5) - 0.5;
    float longitudeOffset =
        fract((longitude / TAU + 0.5) * longitudeCells + 0.5) - 0.5;
    longitudeOffset *= max(abs(cos(latitude)), 0.14);

    float signedDistance =
        abs(latitudeOffset) < abs(longitudeOffset)
        ? latitudeOffset
        : longitudeOffset;
    float width = shellIndex == 2 ? 0.023 : 0.017;
    float normalizedDistance = abs(signedDistance) / width;
    float coverage = 1.0 - smoothstep(1.0, 1.72, normalizedDistance);
    float crown = sqrt(max(0.0, 1.0 - min(normalizedDistance, 1.0) * min(normalizedDistance, 1.0)));

    // Dim the most crowded polar region while retaining the meridians.
    float polarFade = smoothstep(0.01, 0.11, abs(cos(latitude)));
    coverage *= mix(0.48, 1.0, polarFade);

    // A rounded cross-section plus a world-space key light makes each line
    // read as an emissive pipe instead of a flat screen-space stroke.
    vec3 keyLight = normalize(vec3(-0.45, 0.78, 0.62));
    float worldLight = 0.58 + 0.42 * max(dot(normal, keyLight), 0.0);
    float tubeShade = (0.28 + 0.78 * crown) * worldLight;
    tubeShade += 0.34 * pow(crown, 10.0);
    return vec2(coverage, tubeShade);
}

void accumulateGridHit(
    vec3 crossing,
    int shell,
    float coverage,
    inout vec3 gridLight,
    inout float gridOpacity
) {
    vec2 pipe = gridPipe(crossing, shell);
    if (pipe.x <= 0.001) return;

    float photonEmphasis = shell == 2 ? 1.24 : 1.0;
    float alpha =
        saturate(
            pipe.x
            * coverage
            * 0.32
            * photonEmphasis
            * uGridBrightness
        );
    vec3 emission =
        shellColor(shell)
        * (0.38 + 1.30 * pipe.y)
        * photonEmphasis;
    gridLight += (1.0 - gridOpacity) * alpha * emission;
    gridOpacity += (1.0 - gridOpacity) * alpha * 0.82;
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

vec3 trackColor(int index) {
    if (index < 5) return vec3(1.00, 0.12, 0.58);
    if (index == 5) return vec3(1.00, 0.72, 0.08);
    return vec3(0.08, 0.84, 1.00);
}

void accumulateTrackPlaneHit(
    vec3 crossing,
    inout vec3 objectLight,
    inout float objectOpacity
) {
    float radius = length(crossing.xz);
    float planeWindow =
        smoothstep(CAPTURE_RHO + 0.05, 0.76, radius)
        * (1.0 - smoothstep(6.96, 7.28, radius));
    if (planeWindow <= 0.0) return;

    float nearestDistance = 1e10;
    int nearestTrack = 0;
    for (int track = 0; track < TRACK_COUNT; ++track) {
        float distanceToTrack = abs(radius - TRACK_RADII[track]);
        if (distanceToTrack < nearestDistance) {
            nearestDistance = distanceToTrack;
            nearestTrack = track;
        }
    }

    float width = mix(0.018, 0.046, smoothstep(0.72, 6.96, radius));
    float normalizedDistance = nearestDistance / width;
    float trackMask =
        (1.0 - smoothstep(1.0, 1.65, normalizedDistance))
        * planeWindow;
    float crown =
        sqrt(max(0.0, 1.0 - min(normalizedDistance, 1.0) * min(normalizedDistance, 1.0)));

    // A very faint film establishes the equatorial plane; the circular tracks
    // themselves remain effectively opaque.
    float filmAlpha = 0.025 * planeWindow;
    objectLight +=
        (1.0 - objectOpacity)
        * filmAlpha
        * vec3(0.018, 0.026, 0.045);
    objectOpacity += (1.0 - objectOpacity) * filmAlpha;

    if (trackMask <= 0.001) return;
    float trackAlpha = trackMask * mix(0.88, 0.98, crown);
    vec3 material =
        trackColor(nearestTrack)
        * (0.46 + 0.82 * crown)
        + vec3(0.32) * pow(crown, 12.0);
    objectLight += (1.0 - objectOpacity) * trackAlpha * material;
    objectOpacity += (1.0 - objectOpacity) * trackAlpha * 0.96;
}

void accumulateEquatorialCrossing(
    vec3 oldPosition,
    vec3 newPosition,
    float surfaceOpacity,
    inout vec3 objectLight,
    inout float objectOpacity
) {
    if (!uTracksVisible || surfaceOpacity >= 0.999) return;
    bool crossesPlane =
        (oldPosition.y > 0.0 && newPosition.y <= 0.0)
        || (oldPosition.y < 0.0 && newPosition.y >= 0.0);
    if (!crossesPlane) return;

    float denominator = oldPosition.y - newPosition.y;
    if (abs(denominator) < 1e-8) return;
    float crossingT = clamp(oldPosition.y / denominator, 0.0, 1.0);
    if (opaqueSphereBeforeEvent(oldPosition, newPosition, crossingT)) return;
    accumulateTrackPlaneHit(
        mix(oldPosition, newPosition, crossingT),
        objectLight,
        objectOpacity
    );
}

void accumulateShellCrossings(
    vec3 oldPosition,
    vec3 newPosition,
    vec3 rayDirection,
    inout vec3 gridLight,
    inout float gridOpacity,
    inout vec3 surfaceLight,
    inout float surfaceOpacity
) {
    bool gridsActive = uGridVisible && uGridBrightness > 0.0;
    if (!gridsActive && !uSpheresVisible) return;

    vec3 segment = newPosition - oldPosition;
    float segmentLengthSquared = dot(segment, segment);
    if (segmentLengthSquared < 1e-12) return;

    for (int shell = 0; shell < SHELL_COUNT; ++shell) {
        if (shell >= uShellCount) break;
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
                if (gridsActive && surfaceOpacity < 0.999) {
                    accumulateGridHit(
                        crossing,
                        shell,
                        1.0,
                        gridLight,
                        gridOpacity
                    );
                }
                accumulateSphereHit(
                    crossing,
                    rayDirection,
                    shell,
                    1.0,
                    surfaceLight,
                    surfaceOpacity
                );
            }
            if (
                secondRoot > 1e-5
                && secondRoot <= 1.0 + 1e-5
                && abs(secondRoot - firstRoot) > 1e-5
            ) {
                vec3 crossing =
                    oldPosition + segment * clamp(secondRoot, 0.0, 1.0);
                if (gridsActive && surfaceOpacity < 0.999) {
                    accumulateGridHit(
                        crossing,
                        shell,
                        1.0,
                        gridLight,
                        gridOpacity
                    );
                }
                accumulateSphereHit(
                    crossing,
                    rayDirection,
                    shell,
                    1.0,
                    surfaceLight,
                    surfaceOpacity
                );
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
        if (gridsActive && surfaceOpacity < 0.999) {
            accumulateGridHit(
                closestPoint,
                shell,
                edgeCoverage,
                gridLight,
                gridOpacity
            );
        }
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

void traceFlatScene(
    vec3 origin,
    vec3 tangent,
    inout vec3 gridLight,
    inout float gridOpacity,
    inout vec3 surfaceLight,
    inout float surfaceOpacity,
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
        }
    }

    bool gridsActive = uGridVisible && uGridBrightness > 0.0;
    bool spheresActive = uSpheresVisible;
    if (gridsActive || spheresActive) {
        // Outside-to-inside near hits are the correct front-to-back order.
        for (int shell = SHELL_COUNT - 1; shell >= 0; --shell) {
            if (shell >= uShellCount) continue;
            float radius = SHELL_RADII[shell];
            float discriminant =
                originProjection * originProjection - (dot(origin, origin) - radius * radius);
            if (discriminant < 0.0) continue;

            float root = sqrt(discriminant);
            float nearDistance = -originProjection - root;

            if (nearDistance > 1e-5 && nearDistance < horizonDistance) {
                vec3 crossing = origin + tangent * nearDistance;
                if (gridsActive && surfaceOpacity < 0.999) {
                    accumulateGridHit(
                        crossing,
                        shell,
                        1.0,
                        gridLight,
                        gridOpacity
                    );
                }
                if (spheresActive) {
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
            if (shell >= uShellCount) break;
            float radius = SHELL_RADII[shell];
            float discriminant =
                originProjection * originProjection - (dot(origin, origin) - radius * radius);
            if (discriminant < 0.0) continue;

            float farDistance = -originProjection + sqrt(discriminant);
            if (farDistance > 1e-5 && farDistance < horizonDistance) {
                vec3 crossing = origin + tangent * farDistance;
                if (gridsActive && surfaceOpacity < 0.999) {
                    accumulateGridHit(
                        crossing,
                        shell,
                        1.0,
                        gridLight,
                        gridOpacity
                    );
                }
                if (spheresActive) {
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

    if (uTracksVisible && surfaceOpacity < 0.999 && abs(tangent.y) > 1e-7) {
        float planeDistance = -origin.y / tangent.y;
        if (planeDistance > 1e-5 && planeDistance < horizonDistance) {
            accumulateTrackPlaneHit(
                origin + tangent * planeDistance,
                gridLight,
                gridOpacity
            );
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

void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float focalScale = tan(0.5 * uFovY);
    vec3 tangent = normalize(
        uCameraForward
        + uCameraRight * vScreen.x * aspect * focalScale
        + uCameraUp * vScreen.y * focalScale
    );
    vec3 position = uCameraPosition;
    vec3 gridLight = vec3(0.0);
    float gridOpacity = 0.0;
    vec3 surfaceLight = vec3(0.0);
    float surfaceOpacity = 0.0;
    bool captured = false;
    bool escaped = false;
    bool invalidRay = false;

    if (!uLensing) {
        traceFlatScene(
            position,
            tangent,
            gridLight,
            gridOpacity,
            surfaceLight,
            surfaceOpacity,
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

            float rayStep = adaptiveStep(oldRadius);
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

            accumulateEquatorialCrossing(
                oldPosition,
                position,
                surfaceOpacity,
                gridLight,
                gridOpacity
            );
            accumulateShellCrossings(
                oldPosition,
                position,
                tangent,
                gridLight,
                gridOpacity,
                surfaceLight,
                surfaceOpacity
            );
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
    sceneColor *= 1.0 - gridOpacity * 0.42;
    sceneColor += gridLight;
    sceneColor = max(sceneColor, vec3(0.0));
    sceneColor = adjustSaturation(sceneColor, uSaturation);
    sceneColor = vec3(1.0) - exp(-sceneColor * uExposure);
    sceneColor = pow(max(sceneColor, vec3(0.0)), vec3(1.0 / 2.2));

    outColor = vec4(sceneColor, 1.0);
}
