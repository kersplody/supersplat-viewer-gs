import {
    type BoundingBox,
    Mat4,
    Quat,
    Vec3
} from 'playcanvas';

import { createRotateTrack } from './animation/create-rotate-track';
import { AnimController } from './cameras/anim-controller';
import { Camera, type CameraFrame, type CameraController } from './cameras/camera';
import { FlyController } from './cameras/fly-controller';
import { OrbitController } from './cameras/orbit-controller';
import { easeOut } from './core/math';
import { Annotation } from './settings';
import { CameraMode, Global } from './types';

const tmpCamera = new Camera();
const tmpv = new Vec3();
const tmpFramePosition = new Vec3();
const tmpFrameForward = new Vec3();
const tmpFrameTarget = new Vec3();
const tmpCameraForward = new Vec3();
const tmpQuat = new Quat();

type TransformFrame = {
    file_path?: string;
    colmap_im_id?: number;
    transform_matrix?: number[][];
    sort_key?: number;
};

type PreparedTransformFrame = {
    frame: TransformFrame;
    camera: Camera;
    position: Vec3;
    forward: Vec3;
    fov: number;
};

const createCamera = (position: Vec3, target: Vec3, fov: number) => {
    const result = new Camera();
    result.look(position, target);
    result.fov = fov;
    return result;
};

const createFrameCamera = (bbox: BoundingBox, fov: number) => {
    const sceneSize = bbox.halfExtents.length();
    const distance = sceneSize / Math.sin(fov / 180 * Math.PI * 0.5);
    return createCamera(
        new Vec3(2, 1, 2).normalize().mulScalar(distance).add(bbox.center),
        bbox.center,
        fov
    );
};

const getSceneXformDegrees = (geoXform: any) => {
    const direct = geoXform?.playcanvas_candidates?.scene_xyz_deg_x_plus_90;
    if (direct && typeof direct.x === 'number' && typeof direct.y === 'number' && typeof direct.z === 'number') {
        return direct;
    }

    const candidates = geoXform?.playcanvas_candidates;
    if (candidates && typeof candidates === 'object') {
        for (const candidate of Object.values(candidates as Record<string, any>)) {
            const degrees = candidate?.scene_xyz_deg_x_plus_90;
            if (degrees && typeof degrees.x === 'number' && typeof degrees.y === 'number' && typeof degrees.z === 'number') {
                return degrees;
            }
        }
    }

    const legacy = geoXform?.playcanvas_scene_xyz_deg_x_plus_90;
    if (legacy && typeof legacy.x === 'number' && typeof legacy.y === 'number' && typeof legacy.z === 'number') {
        return legacy;
    }

    return null;
};

const frameToCamera = (frame: TransformFrame, fov: number, worldRotation: Mat4 | null) => {
    const m = frame.transform_matrix;
    if (!Array.isArray(m) || m.length < 3 ||
        !Array.isArray(m[0]) || m[0].length < 4 ||
        !Array.isArray(m[1]) || m[1].length < 4 ||
        !Array.isArray(m[2]) || m[2].length < 4) {
        return null;
    }

    // COLMAP/NeRF transform_matrix is camera-to-world. Camera forward is -Z (third column negated).
    tmpFramePosition.set(m[0][3], m[1][3], m[2][3]);
    tmpFrameForward.set(-m[0][2], -m[1][2], -m[2][2]).normalize();

    if (worldRotation) {
        worldRotation.transformPoint(tmpFramePosition, tmpFramePosition);
        worldRotation.transformVector(tmpFrameForward, tmpFrameForward).normalize();
    }

    const result = new Camera();
    tmpFrameTarget.copy(tmpFramePosition).add(tmpFrameForward);
    result.look(tmpFramePosition, tmpFrameTarget);
    result.fov = fov;
    return result;
};

const extractFrameSortKey = (frame: TransformFrame) => {
    const filePath = frame.file_path ?? '';
    const match = filePath.match(/frame_(\d+)(?:\.[^./\\]+)?$/i);
    if (match) {
        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return Number.POSITIVE_INFINITY;
};

const extractTransformsFov = (transforms: any, fallbackFov: number) => {
    const w = transforms?.w;
    const flX = transforms?.fl_x;
    if (typeof w === 'number' && typeof flX === 'number' && w > 0 && flX > 0) {
        return 2 * Math.atan(w / (2 * flX)) * 180 / Math.PI;
    }

    const cameraAngleX = transforms?.camera_angle_x;
    if (typeof cameraAngleX === 'number' && cameraAngleX > 0) {
        return cameraAngleX * 180 / Math.PI;
    }

    return fallbackFov;
};

const cameraForwardFromAngles = (camera: Camera, out: Vec3) => {
    tmpQuat.setFromEulerAngles(camera.angles).transformVector(Vec3.FORWARD, out).normalize();
    return out;
};

class CameraManager {
    update: (deltaTime: number, cameraFrame: CameraFrame) => void;

    // holds the camera state
    camera = new Camera();

    constructor(global: Global, bbox: BoundingBox) {
        const { events, settings, state, transforms, geoXform } = global;

        const camera0 = settings.cameras[0].initial;
        const frameCamera = createFrameCamera(bbox, camera0.fov);
        const resetCamera = createCamera(new Vec3(camera0.position), new Vec3(camera0.target), camera0.fov);

        const getAnimTrack = (initial: Camera, isObjectExperience: boolean) => {
            const { animTracks } = settings;

            // extract the camera animation track from settings
            if (animTracks?.length > 0 && settings.startMode === 'animTrack') {
                // use the first animTrack
                return animTracks[0];
            } else if (isObjectExperience) {
                // create basic rotation animation if no anim track is specified
                initial.calcFocusPoint(tmpv);
                return createRotateTrack(initial.position, tmpv, initial.fov);
            }
            return null;
        };

        // object experience starts outside the bounding box
        const isObjectExperience = !bbox.containsPoint(resetCamera.position);
        const animTrack = getAnimTrack(settings.hasStartPose ? resetCamera : frameCamera, isObjectExperience);

        const controllers = {
            orbit: new OrbitController(),
            fly: new FlyController(),
            anim: animTrack ? new AnimController(animTrack) : null
        };

        const getController = (cameraMode: 'orbit' | 'anim' | 'fly'): CameraController => {
            return controllers[cameraMode];
        };

        const transformFrames = (Array.isArray(transforms?.frames) ? transforms.frames : []) as TransformFrame[];
        const validTransformFrames = transformFrames
            .filter((frame) => Array.isArray(frame?.transform_matrix))
            .map((frame) => ({
                ...frame,
                sort_key: extractFrameSortKey(frame)
            }))
            .sort((a, b) => {
                const byFrameNumber = a.sort_key - b.sort_key;
                if (byFrameNumber !== 0) {
                    return byFrameNumber;
                }
                return (a.file_path ?? '').localeCompare(b.file_path ?? '');
            });
        const sceneRotationDegrees = getSceneXformDegrees(geoXform);
        const sceneRotation = sceneRotationDegrees
            ? new Mat4().setFromEulerAngles(sceneRotationDegrees.x, sceneRotationDegrees.y, sceneRotationDegrees.z)
            : null;
        const transformsFov = extractTransformsFov(transforms, camera0.fov);
        const preparedTransformFrames: PreparedTransformFrame[] = [];
        validTransformFrames.forEach((frame) => {
            const camera = frameToCamera(frame, transformsFov, sceneRotation);
            if (!camera) {
                return;
            }
            preparedTransformFrames.push({
                frame,
                camera,
                position: new Vec3().copy(camera.position),
                forward: cameraForwardFromAngles(camera, new Vec3()),
                fov: camera.fov
            });
        });
        let transformFrameIndex = -1;

        const emitSelectedTransformFrame = () => {
            if (transformFrameIndex < 0 || transformFrameIndex >= preparedTransformFrames.length) {
                return;
            }

            const selected = preparedTransformFrames[transformFrameIndex].frame;
            events.fire('transformFrame:selected', {
                index: transformFrameIndex,
                count: preparedTransformFrames.length,
                filePath: selected.file_path ?? null,
                colmapImId: selected.colmap_im_id ?? null
            });
        };

        const pickNearestFrameForCurrentView = (emitSelection: boolean = true): number => {
            if (preparedTransformFrames.length === 0) {
                return -1;
            }

            const sceneScale = Math.max(1e-3, bbox.halfExtents.length() * 2);
            const currentForward = cameraForwardFromAngles(this.camera, tmpCameraForward);

            let bestIndex = -1;
            let bestScore = Number.POSITIVE_INFINITY;

            for (let i = 0; i < preparedTransformFrames.length; i++) {
                const candidate = preparedTransformFrames[i];
                const positionDistNorm = this.camera.position.distance(candidate.position) / sceneScale;
                const directionDot = Math.max(-1, Math.min(1, currentForward.dot(candidate.forward)));
                const directionDiffNorm = Math.acos(directionDot) / Math.PI;
                const fovDiffNorm = Math.min(1, Math.abs(this.camera.fov - candidate.fov) / 90);
                const behindPenalty = directionDot < 0 ? 0.5 : 0;

                const score = positionDistNorm * 0.4 + directionDiffNorm * 0.5 + fovDiffNorm * 0.1 + behindPenalty;
                if (score < bestScore) {
                    bestScore = score;
                    bestIndex = i;
                }
            }

            if (bestIndex < 0) {
                return -1;
            }

            transformFrameIndex = bestIndex;
            const selected = preparedTransformFrames[bestIndex].frame;
            const frameName = selected.file_path ?? `colmap_im_id:${selected.colmap_im_id ?? 'unknown'}`;
            console.log(`[transforms] nearest frame ${bestIndex + 1}/${preparedTransformFrames.length}: ${frameName}`);
            if (emitSelection) {
                emitSelectedTransformFrame();
            }
            return bestIndex;
        };

        const gotoTransformFrameIndex = (index: number, logPrefix: string) => {
            if (index < 0 || index >= preparedTransformFrames.length) {
                return;
            }

            transformFrameIndex = index;
            const selected = preparedTransformFrames[transformFrameIndex];

            state.cameraMode = 'orbit';
            controllers.orbit.goto(selected.camera);
            emitSelectedTransformFrame();

            const frameName = selected.frame.file_path ?? `colmap_im_id:${selected.frame.colmap_im_id ?? 'unknown'}`;
            console.log(`${logPrefix} ${transformFrameIndex + 1}/${preparedTransformFrames.length}: ${frameName}`);
        };

        const stepTransformFrame = (step: 1 | -1) => {
            const count = preparedTransformFrames.length;
            if (count === 0) {
                return;
            }

            if (transformFrameIndex < 0) {
                const nearestIndex = pickNearestFrameForCurrentView();
                if (nearestIndex < 0) {
                    return;
                }
            }

            transformFrameIndex = (transformFrameIndex + step + count) % count;
            gotoTransformFrameIndex(transformFrameIndex, '[transforms] camera -> frame');
        };

        // set the global animation flag
        state.hasAnimation = !!controllers.anim;
        state.animationDuration = controllers.anim ? controllers.anim.animState.cursor.duration : 0;

        // initialize camera mode and initial camera position
        state.cameraMode = state.hasAnimation ? 'anim' : (isObjectExperience ? 'orbit' : 'fly');
        this.camera.copy(resetCamera);

        const target = new Camera(this.camera);             // the active controller updates this
        const from = new Camera(this.camera);               // stores the previous camera state during transition
        let fromMode: CameraMode = isObjectExperience ? 'orbit' : 'fly';

        // enter the initial controller
        getController(state.cameraMode).onEnter(this.camera);

        // transition state
        const transitionSpeed = 1.0;
        let transitionTimer = 1;
        const previousPosition = new Vec3().copy(this.camera.position);
        const previousForward = cameraForwardFromAngles(this.camera, new Vec3());
        let previousFov = this.camera.fov;
        let wasMoving = false;
        let settledTime = 0;

        const positionDeltaThreshold = 1e-3;
        const angleDeltaThreshold = 0.2 * Math.PI / 180;
        const fovDeltaThreshold = 0.01;
        const settleDelaySeconds = 0.2;

        // start a new camera transition from the current pose
        const startTransition = () => {
            from.copy(this.camera);
            transitionTimer = 0;
        };

        // application update
        this.update = (deltaTime: number, frame: CameraFrame) => {

            // use dt of 0 if animation is paused
            const dt = state.cameraMode === 'anim' && state.animationPaused ? 0 : deltaTime;

            // update transition timer
            transitionTimer = Math.min(1, transitionTimer + deltaTime * transitionSpeed);

            const controller = getController(state.cameraMode);

            controller.update(dt, frame, target);

            if (transitionTimer < 1) {
                // lerp away from previous camera during transition
                this.camera.lerp(from, target, easeOut(transitionTimer));
            } else {
                this.camera.copy(target);
            }

            // update animation timeline
            if (state.cameraMode === 'anim') {
                state.animationTime = controllers.anim.animState.cursor.value;
            }

            const currentForward = cameraForwardFromAngles(this.camera, tmpCameraForward);
            const positionDelta = this.camera.position.distance(previousPosition);
            const dot = Math.max(-1, Math.min(1, previousForward.dot(currentForward)));
            const angleDelta = Math.acos(dot);
            const fovDelta = Math.abs(this.camera.fov - previousFov);
            const movingNow = positionDelta > positionDeltaThreshold || angleDelta > angleDeltaThreshold || fovDelta > fovDeltaThreshold;

            if (movingNow) {
                wasMoving = true;
                settledTime = 0;
            } else if (wasMoving) {
                settledTime += deltaTime;
                if (settledTime >= settleDelaySeconds) {
                    wasMoving = false;
                    settledTime = 0;
                    pickNearestFrameForCurrentView();
                }
            }

            previousPosition.copy(this.camera.position);
            previousForward.copy(currentForward);
            previousFov = this.camera.fov;
        };

        // handle input events
        events.on('inputEvent', (eventName, event) => {
            switch (eventName) {
                case 'frame':
                    state.cameraMode = 'orbit';
                    controllers.orbit.goto(frameCamera);
                    startTransition();
                    break;
                case 'reset':
                    state.cameraMode = 'orbit';
                    controllers.orbit.goto(resetCamera);
                    startTransition();
                    break;
                case 'playPause':
                    if (state.hasAnimation) {
                        if (state.cameraMode === 'anim') {
                            state.animationPaused = !state.animationPaused;
                        } else {
                            state.cameraMode = 'anim';
                            state.animationPaused = false;
                        }
                    }
                    break;
                case 'cancel':
                case 'interrupt':
                    if (state.cameraMode === 'anim') {
                        state.cameraMode = fromMode;
                    }
                    break;
                case 'prevTransformFrame':
                    stepTransformFrame(-1);
                    break;
                case 'nextTransformFrame':
                    stepTransformFrame(1);
                    break;
                case 'gotoNearestTransformFrame': {
                    const nearestIndex = pickNearestFrameForCurrentView(false);
                    if (nearestIndex >= 0) {
                        gotoTransformFrameIndex(nearestIndex, '[transforms] camera -> nearest frame');
                    }
                    break;
                }
                case 'gotoCurrentTransformFrame':
                    if (transformFrameIndex >= 0) {
                        gotoTransformFrameIndex(transformFrameIndex, '[transforms] camera -> selected frame');
                    }
                    break;
            }
        });

        // handle camera mode switching
        events.on('cameraMode:changed', (value, prev) => {
            // snapshot the current pose before any controller mutation
            startTransition();

            target.copy(this.camera);
            fromMode = prev;

            // exit the old controller
            const prevController = getController(prev);
            prevController.onExit(this.camera);

            // enter new controller
            const newController = getController(value);
            newController.onEnter(this.camera);
        });

        // handle user scrubbing the animation timeline
        events.on('scrubAnim', (time) => {
            // switch to animation camera if we're not already there
            state.cameraMode = 'anim';

            // set time
            controllers.anim.animState.cursor.value = time;
        });

        // handle user picking in the scene
        events.on('pick', (position: Vec3) => {
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';

            // construct camera
            tmpCamera.copy(this.camera);
            tmpCamera.look(this.camera.position, position);

            controllers.orbit.goto(tmpCamera);
            startTransition();
        });

        events.on('annotation.activate', (annotation: Annotation) => {
            // switch to orbit camera on pick
            state.cameraMode = 'orbit';

            const { initial } = annotation.camera;

            // construct camera
            tmpCamera.fov = initial.fov;
            tmpCamera.look(
                new Vec3(initial.position),
                new Vec3(initial.target)
            );

            controllers.orbit.goto(tmpCamera);
            target.fov = tmpCamera.fov;
            startTransition();
        });
    }
}

export { CameraManager };
