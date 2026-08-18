import { Mat4, Quat, Vec3 } from 'playcanvas';
import type { BoundingBox, EventHandler } from 'playcanvas';

import { Camera } from './cameras/camera';
import type { Global } from './types';

type TransformFrame = {
    file_path?: string;
    colmap_im_id?: number;
    transform_matrix?: number[][];
    sort_key?: number;
};

type TransformData = {
    frames?: TransformFrame[];
    w?: number;
    h?: number;
    fl_x?: number;
    fl_y?: number;
    cx?: number;
    cy?: number;
    camera_angle_x?: number;
};

type PreparedTransformFrame = {
    frame: TransformFrame;
    imageIndex: number | null;
    camera: Camera;
    runtimeCamera: Camera;
    position: Vec3;
    forward: Vec3;
    fov: number;
};

type PipInspectState = {
    active: boolean;
    zoom?: number;
    panX?: number;
    panY?: number;
    imageWidth?: number;
    imageHeight?: number;
    sourceWidth?: number;
    sourceHeight?: number;
    centerU?: number;
    centerV?: number;
};

type CameraIntrinsics = {
    width: number;
    height: number;
    fx: number;
    fy: number;
    cx: number;
    cy: number;
};

type TransformFrameHooks = {
    goTo: (camera: Camera, retainFlyMode: boolean) => void;
    applyPip: (camera: Camera) => void;
};

type ImageSourceRange = {
    start: number;
    end: number;
};

const tmpFramePosition = new Vec3();
const tmpFrameForward = new Vec3();
const tmpFrameUp = new Vec3();
const tmpFrameTarget = new Vec3();
const tmpCameraForward = new Vec3();
const tmpQuat = new Quat();
const tmpQuat2 = new Quat();
const tmpLookAt = new Mat4();
const tmpPipDir = new Vec3();
const tmpPipWorldDir = new Vec3();
const tmpPipTarget = new Vec3();

const cameraForwardFromAngles = (camera: Camera, out: Vec3) => {
    tmpQuat.setFromEulerAngles(camera.angles).transformVector(Vec3.FORWARD, out).normalize();
    return out;
};

const frameToCamera = (frame: TransformFrame, fov: number, worldRotation: Mat4 | null) => {
    const m = frame.transform_matrix;
    if (
        !Array.isArray(m) ||
        m.length < 3 ||
        !Array.isArray(m[0]) ||
        m[0].length < 4 ||
        !Array.isArray(m[1]) ||
        m[1].length < 4 ||
        !Array.isArray(m[2]) ||
        m[2].length < 4
    ) {
        return null;
    }

    tmpFramePosition.set(m[0][3], m[1][3], m[2][3]);
    tmpFrameForward.set(-m[0][2], -m[1][2], -m[2][2]).normalize();
    tmpFrameUp.set(m[0][1], m[1][1], m[2][1]).normalize();

    if (worldRotation) {
        worldRotation.transformPoint(tmpFramePosition, tmpFramePosition);
        worldRotation.transformVector(tmpFrameForward, tmpFrameForward).normalize();
        worldRotation.transformVector(tmpFrameUp, tmpFrameUp).normalize();
    }

    tmpFrameTarget.copy(tmpFramePosition).add(tmpFrameForward);

    const camera = new Camera();
    camera.position.copy(tmpFramePosition);
    camera.distance = 1;
    tmpLookAt.setLookAt(tmpFramePosition, tmpFrameTarget, tmpFrameUp);
    tmpQuat2.setFromMat4(tmpLookAt).getEulerAngles(camera.angles);
    camera.fov = fov;

    const runtimeCamera = new Camera();
    runtimeCamera.look(tmpFramePosition, tmpFrameTarget);
    runtimeCamera.fov = fov;

    return {
        camera,
        runtimeCamera,
        position: tmpFramePosition.clone(),
        forward: cameraForwardFromAngles(runtimeCamera, new Vec3()),
        fov
    };
};

const extractFrameSortKey = (frame: TransformFrame) => {
    const match = (frame.file_path ?? '').match(/frame_(\d+)(?:\.[^./\\]+)?$/i);
    return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
};

const extractImageIndex = (frame: TransformFrame) => {
    if (typeof frame.colmap_im_id === 'number' && Number.isFinite(frame.colmap_im_id)) {
        return frame.colmap_im_id;
    }
    const value = extractFrameSortKey(frame);
    return Number.isFinite(value) ? value : null;
};

const extractSourceRanges = (value: unknown): ImageSourceRange[] => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
    const sources = (value as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) return [];

    const ranges = sources.flatMap((source) => {
        if (source === null || typeof source !== 'object' || Array.isArray(source)) return [];
        const { start_image_idx: start, end_image_idx: end } = source as {
            start_image_idx?: unknown;
            end_image_idx?: unknown;
        };
        return typeof start === 'number' && typeof end === 'number' && start <= end ? [{ start, end }] : [];
    });

    // Some combined-scene imdat files retain source-local indices for captures
    // after the first one. Convert an overlapping range into the concatenated
    // global numbering used by transforms.json and the images directories.
    for (let index = 1; index < ranges.length; index++) {
        const previous = ranges[index - 1];
        const current = ranges[index];
        if (current.start <= previous.end) {
            const offset = previous.end + 1 - current.start;
            current.start += offset;
            current.end += offset;
        }
    }
    return ranges;
};

const extractTransformsFov = (transforms: TransformData, fallbackFov: number) => {
    if (
        typeof transforms.w === 'number' &&
        typeof transforms.fl_x === 'number' &&
        transforms.w > 0 &&
        transforms.fl_x > 0
    ) {
        return (2 * Math.atan(transforms.w / (2 * transforms.fl_x)) * 180) / Math.PI;
    }
    if (typeof transforms.camera_angle_x === 'number' && transforms.camera_angle_x > 0) {
        return (transforms.camera_angle_x * 180) / Math.PI;
    }
    return fallbackFov;
};

const extractCameraIntrinsics = (transforms: TransformData): CameraIntrinsics | null => {
    const { w: width, h: height, fl_x: fx, fl_y: fy } = transforms;
    if (!(typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0)) return null;
    if (!(typeof fx === 'number' && fx > 0) && !(typeof fy === 'number' && fy > 0)) return null;

    const resolvedFx = typeof fx === 'number' && fx > 0 ? fx : fy!;
    const resolvedFy = typeof fy === 'number' && fy > 0 ? fy : fx!;
    return {
        width,
        height,
        fx: resolvedFx,
        fy: resolvedFy,
        cx: typeof transforms.cx === 'number' ? transforms.cx : width * 0.5,
        cy: typeof transforms.cy === 'number' ? transforms.cy : height * 0.5
    };
};

class TransformFrameNavigator {
    private readonly _events: EventHandler;

    private readonly _camera: Camera;

    private readonly _hooks: TransformFrameHooks;

    private readonly _bbox: BoundingBox;

    private readonly _frames: PreparedTransformFrame[];

    private readonly _intrinsics: CameraIntrinsics | null;

    private readonly _sourceRanges: ImageSourceRange[];

    private readonly _previousPosition: Vec3;

    private readonly _previousForward: Vec3;

    private _previousFov: number;

    private _index = -1;

    private _activeSplat: 1 | 2;

    private _pipActive = false;

    private _pipState: PipInspectState = { active: false };

    private _wasMoving = false;

    private _settledTime = 0;

    constructor(global: Global, bbox: BoundingBox, defaultFov: number, camera: Camera, hooks: TransformFrameHooks) {
        this._events = global.events;
        this._camera = camera;
        this._hooks = hooks;
        this._bbox = bbox;
        this._activeSplat = global.state.activeSplat;
        this._sourceRanges = extractSourceRanges(global.imdat);

        const transforms =
            global.transforms && typeof global.transforms === 'object' ? (global.transforms as TransformData) : {};
        const frames = Array.isArray(transforms.frames) ? transforms.frames : [];
        const rotation = global.settings.sceneRotation;
        const worldRotation = rotation ? new Mat4().setFromEulerAngles(rotation.x, rotation.y, rotation.z) : null;
        const fov = extractTransformsFov(transforms, defaultFov);
        this._intrinsics = extractCameraIntrinsics(transforms);
        this._frames = frames
            .filter((frame) => Array.isArray(frame?.transform_matrix))
            .map((frame) => ({ ...frame, sort_key: extractFrameSortKey(frame) }))
            .sort(
                (a, b) => (a.sort_key ?? 0) - (b.sort_key ?? 0) || (a.file_path ?? '').localeCompare(b.file_path ?? '')
            )
            .flatMap((frame) => {
                const prepared = frameToCamera(frame, fov, worldRotation);
                return prepared ? [{ frame, imageIndex: extractImageIndex(frame), ...prepared }] : [];
            });

        this._previousPosition = camera.position.clone();
        this._previousForward = cameraForwardFromAngles(camera, new Vec3());
        this._previousFov = camera.fov;

        this._events.on('pipInspect:changed', (state: PipInspectState) => {
            this._pipState = state ?? { active: false };
            this._pipActive = !!state?.active;
            this._applyPipInspectCamera();
        });
        this._events.on('activeSplat:changed', (value: 1 | 2) => {
            this._activeSplat = value;
            const nearest = this._pickNearest();
            if (nearest >= 0) {
                const candidates = this._candidateIndices();
                this._events.fire('transformFrame:nearestUpdated', {
                    index: candidates.indexOf(nearest),
                    count: candidates.length
                });
            }
        });
    }

    private _candidateIndices() {
        const all = this._frames.map((_frame, index) => index);
        const range = this._sourceRanges[this._activeSplat - 1];
        if (!range) return all;

        const filtered = this._frames.flatMap((frame, index) =>
            frame.imageIndex !== null && frame.imageIndex >= range.start && frame.imageIndex <= range.end ? [index] : []
        );
        return filtered.length > 0 ? filtered : all;
    }

    private _emitSelected() {
        const selected = this._frames[this._index]?.frame;
        if (!selected) return;
        const candidates = this._candidateIndices();
        this._events.fire('transformFrame:selected', {
            index: candidates.indexOf(this._index),
            count: candidates.length,
            filePath: selected.file_path ?? null,
            colmapImId: selected.colmap_im_id ?? null
        });
    }

    private _pickNearest(emitSelection = true) {
        const candidates = this._candidateIndices();
        if (candidates.length === 0) return -1;

        const sceneScale = Math.max(1e-3, this._bbox.halfExtents.length() * 2);
        const currentForward = cameraForwardFromAngles(this._camera, tmpCameraForward);
        let bestIndex = -1;
        let bestScore = Number.POSITIVE_INFINITY;

        for (const i of candidates) {
            const candidate = this._frames[i];
            const positionDist = this._camera.position.distance(candidate.position) / sceneScale;
            const directionDot = Math.max(-1, Math.min(1, currentForward.dot(candidate.forward)));
            const directionDiff = Math.acos(directionDot) / Math.PI;
            const fovDiff = Math.min(1, Math.abs(this._camera.fov - candidate.fov) / 90);
            const score = positionDist * 0.4 + directionDiff * 0.5 + fovDiff * 0.1 + (directionDot < 0 ? 0.5 : 0);
            if (score < bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        this._index = bestIndex;
        if (emitSelection && bestIndex >= 0) this._emitSelected();
        return bestIndex;
    }

    private _goTo(index: number, retainFlyMode = false) {
        const selected = this._frames[index];
        if (!selected) return;
        this._index = index;
        this._hooks.goTo(selected.runtimeCamera, retainFlyMode);
        this._emitSelected();
    }

    private _step(step: 1 | -1) {
        const candidates = this._candidateIndices();
        if (candidates.length === 0) return;
        if (this._index < 0 && this._pickNearest(false) < 0) return;
        let position = candidates.indexOf(this._index);
        if (position < 0) {
            if (this._pickNearest(false) < 0) return;
            position = candidates.indexOf(this._index);
        }
        this._goTo(candidates[(position + step + candidates.length) % candidates.length]);
    }

    private _applyPipInspectCamera() {
        const state = this._pipState;
        const prepared = this._frames[this._index];
        if (!state.active || !prepared) return;

        const zoom = Math.max(1e-3, state.zoom ?? 1);
        const imageWidth = state.imageWidth ?? 0;
        const imageHeight = state.imageHeight ?? 0;
        if (!(imageWidth > 0 && imageHeight > 0)) return;

        const base = prepared.camera;
        const halfTan = Math.tan((base.fov * Math.PI) / 360);
        const pipFov = (2 * Math.atan(halfTan / zoom) * 180) / Math.PI;

        if (this._intrinsics) {
            const sourceWidth = state.sourceWidth ?? this._intrinsics.width;
            const sourceHeight = state.sourceHeight ?? this._intrinsics.height;
            const pixelsPerImageX = imageWidth / sourceWidth;
            const pixelsPerImageY = imageHeight / sourceHeight;
            const centerU = state.centerU ?? sourceWidth * 0.5 - (state.panX ?? 0) / (zoom * pixelsPerImageX);
            const centerV = state.centerV ?? sourceHeight * 0.5 - (state.panY ?? 0) / (zoom * pixelsPerImageY);
            const u = centerU * (this._intrinsics.width / sourceWidth);
            const v = centerV * (this._intrinsics.height / sourceHeight);
            tmpPipDir
                .set(
                    (u - this._intrinsics.cx) / this._intrinsics.fx,
                    -(v - this._intrinsics.cy) / this._intrinsics.fy,
                    -1
                )
                .normalize();
        } else {
            const halfTanX = halfTan * (imageWidth / imageHeight);
            tmpPipDir
                .set(
                    (-2 * (state.panX ?? 0) * halfTanX) / (zoom * imageWidth),
                    (2 * (state.panY ?? 0) * halfTan) / (zoom * imageHeight),
                    -1
                )
                .normalize();
        }

        tmpQuat2.setFromEulerAngles(base.angles).transformVector(tmpPipDir, tmpPipWorldDir).normalize();
        tmpPipTarget.copy(base.position).add(tmpPipWorldDir);
        const camera = new Camera();
        camera.look(base.position, tmpPipTarget);
        camera.fov = pipFov;
        this._hooks.applyPip(camera);
    }

    handleInput(eventName: string, options?: { retainCameraMode?: boolean }) {
        switch (eventName) {
            case 'prevTransformFrame':
                this._step(-1);
                return true;
            case 'nextTransformFrame':
                this._step(1);
                return true;
            case 'gotoNearestTransformFrame': {
                const index = this._pickNearest(false);
                if (index >= 0) this._goTo(index);
                return true;
            }
            case 'gotoCurrentTransformFrame':
                if (this._index >= 0) this._goTo(this._index, !!options?.retainCameraMode);
                return true;
            default:
                return false;
        }
    }

    update(deltaTime: number) {
        if (this._index < 0) this._pickNearest();
        if (this._pipActive) this._applyPipInspectCamera();

        const currentForward = cameraForwardFromAngles(this._camera, tmpCameraForward);
        const positionDelta = this._camera.position.distance(this._previousPosition);
        const directionDot = Math.max(-1, Math.min(1, this._previousForward.dot(currentForward)));
        const moving =
            positionDelta > 1e-3 ||
            Math.acos(directionDot) > (0.2 * Math.PI) / 180 ||
            Math.abs(this._camera.fov - this._previousFov) > 0.01;

        if (moving) {
            this._wasMoving = true;
            this._settledTime = 0;
        } else if (this._wasMoving) {
            this._settledTime += deltaTime;
            if (this._settledTime >= 0.2) {
                this._wasMoving = false;
                this._settledTime = 0;
                if (!this._pipActive) {
                    const previous = this._index;
                    const nearest = this._pickNearest();
                    if (nearest >= 0 && nearest !== previous) {
                        const candidates = this._candidateIndices();
                        this._events.fire('transformFrame:nearestUpdated', {
                            index: candidates.indexOf(nearest),
                            count: candidates.length
                        });
                    }
                }
            }
        }

        this._previousPosition.copy(this._camera.position);
        this._previousForward.copy(currentForward);
        this._previousFov = this._camera.fov;
    }
}

export { TransformFrameNavigator };
