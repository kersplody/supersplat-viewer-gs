import {
    Color,
    Entity,
    Quat,
    Vec3,
    type CameraComponent
} from 'playcanvas';
import { XrControllers } from './xr-controllers';
import { XrNavigation } from 'playcanvas/scripts/esm/xr-navigation.mjs';

import { Global } from './types';

// On entering/exiting AR, we need to set the camera clear color to transparent black
const initXr = (global: Global) => {
    const { app, events, state, camera, settings } = global;

    state.hasAR = app.xr.isAvailable('immersive-ar');
    state.hasVR = app.xr.isAvailable('immersive-vr');

    // initialize ar/vr
    app.xr.on('available:immersive-ar', (available) => {
        state.hasAR = available;
    });
    app.xr.on('available:immersive-vr', (available) => {
        state.hasVR = available;
    });

    const parent = camera.parent as Entity;
    const clearColor = new Color();

    const parentPosition = new Vec3();
    const parentRotation = new Quat();
    const cameraPosition = new Vec3();
    const cameraRotation = new Quat();
    const angles = new Vec3();

    parent.addComponent('script');
    parent.script.create(XrControllers);
    const xrNavigation = parent.script.create(XrNavigation);
    if (xrNavigation) {
        const nav = xrNavigation as { enableTeleport?: boolean; tryTeleport?: (inputSource: any) => void };
        nav.enableTeleport = false;
        nav.tryTeleport = () => {};
    }

    const teleportMaxDistance = 10;
    const clickMaxDurationMs = 350;
    const dragStartThreshold = 0.03;
    const dragMoveThreshold = 0.005;

    const parentPos = new Vec3();

    const inputHandlers = new Map<any, {
        handleSelectStart: Function,
        handleSelectEnd: Function,
        handleSqueezeStart: Function,
        handleSqueezeEnd: Function
    }>();
    const movedInputs = new Set<any>();
    const dragState = new Map<any, {
        startTime: number,
        startHeight: number,
        startOrigin: Vec3,
        mode: 'select' | 'squeeze',
        active: boolean,
        moved: boolean,
        dragging: boolean
    }>();

    const getInputOrigin = (inputSource: any): Vec3 | null => {
        if (!inputSource) {
            return null;
        }
        try {
            if (typeof inputSource.getOrigin === 'function') {
                const origin = inputSource.getOrigin();
                if (origin) {
                    return origin;
                }
            }
        } catch {
            // ignore; will try getPosition
        }
        try {
            if (typeof inputSource.getPosition === 'function') {
                const pos = inputSource.getPosition();
                if (pos) {
                    return pos;
                }
            }
        } catch {
            // ignore; some platforms throw when grip pose is unavailable
        }
        return null;
    };

    const getInputDirection = (inputSource: any): Vec3 | null => {
        if (!inputSource) {
            return null;
        }
        try {
            if (typeof inputSource.getDirection === 'function') {
                const direction = inputSource.getDirection();
                if (direction) {
                    return direction;
                }
            }
        } catch {
            // ignore; direction may be unavailable
        }
        return null;
    };

    const getHandJointPosition = (inputSource: any): Vec3 | null => {
        const hand = inputSource?.hand;
        if (!hand || typeof hand.getJointById !== 'function') {
            return null;
        }
        const joint = hand.getJointById('index-finger-tip') || hand.getJointById('wrist');
        if (!joint || typeof joint.getPosition !== 'function') {
            return null;
        }
        try {
            return joint.getPosition();
        } catch {
            return null;
        }
    };

    const getDragOrigin = (inputSource: any): Vec3 | null => {
        const jointPos = getHandJointPosition(inputSource);
        if (jointPos) {
            return jointPos;
        }
        return getInputOrigin(inputSource);
    };

    const findPlaneIntersection = (origin: Vec3, direction: Vec3): Vec3 | null => {
        if (Math.abs(direction.y) < 0.00001) {
            return null;
        }

        const t = -origin.y / direction.y;
        if (t < 0) {
            return null;
        }

        return new Vec3(
            origin.x + direction.x * t,
            0,
            origin.z + direction.z * t
        );
    };

    const tryTeleport = (inputSource: any) => {
        const origin = getInputOrigin(inputSource);
        const direction = getInputDirection(inputSource);
        if (!origin || !direction) {
            return;
        }

        const hitPoint = findPlaneIntersection(origin, direction);
        if (!hitPoint) {
            return;
        }

        const distance = hitPoint.distance(parent.getPosition());
        if (distance > teleportMaxDistance) {
            return;
        }

        const current = parent.getPosition();
        hitPoint.y = current.y;
        parent.setPosition(hitPoint);
    };

    app.xr.on('start', () => {
        app.autoRender = true;

        // cache original camera rig positions and rotations
        parentPosition.copy(parent.getPosition());
        parentRotation.copy(parent.getRotation());
        cameraPosition.copy(camera.getPosition());
        cameraRotation.copy(camera.getRotation());

        cameraRotation.getEulerAngles(angles);

        // copy transform to parent to XR/VR mode starts in the right place
        const xrHeight = Number.isFinite(settings.xrheight) ? settings.xrheight : 0;
        parent.setPosition(cameraPosition.x, xrHeight, cameraPosition.z);
        parent.setEulerAngles(0, angles.y, 0);

        if (app.xr.type === 'immersive-ar') {
            clearColor.copy(camera.camera.clearColor);
            camera.camera.clearColor = new Color(0, 0, 0, 0);
        }
    });

    app.xr.on('end', () => {
        app.autoRender = false;

        // restore camera to pre-XR state
        parent.setPosition(parentPosition);
        parent.setRotation(parentRotation);
        camera.setPosition(cameraPosition);
        camera.setRotation(cameraRotation);

        if (app.xr.type === 'immersive-ar') {
            camera.camera.clearColor = clearColor;
        }

        // Restore the canvas to the correct position in the DOM after exiting XR. In
        // some browsers (e.g. Chrome on Android) the canvas is moved to a new root
        // during XR, and needs to be moved back on exit.
        for (const [inputSource, handlers] of inputHandlers) {
            inputSource.off('selectstart', handlers.handleSelectStart);
            inputSource.off('selectend', handlers.handleSelectEnd);
            inputSource.off('squeezestart', handlers.handleSqueezeStart);
            inputSource.off('squeezeend', handlers.handleSqueezeEnd);
        }
        inputHandlers.clear();
        dragState.clear();
        movedInputs.clear();

        requestAnimationFrame(() => {
            document.body.prepend(app.graphicsDevice.canvas);
            app.renderNextFrame = true;
        });
    });

    app.xr.input.on('add', (inputSource) => {
        const beginDrag = (mode: 'select' | 'squeeze') => {
            const origin = getDragOrigin(inputSource);
            const startOrigin = new Vec3();
            if (origin) {
                startOrigin.copy(origin);
            }

            dragState.set(inputSource, {
                startTime: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
                startHeight: parent.getPosition().y,
                startOrigin,
                mode,
                active: !!origin,
                moved: false,
                dragging: false
            });
        };

        const handleSelectStart = () => {
            beginDrag('select');
        };

        const handleSelectEnd = () => {
            const state = dragState.get(inputSource);
            if (!state) {
                return;
            }

            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const heldMs = now - state.startTime;

            const suppressTeleport = movedInputs.has(inputSource);
            if (state.mode === 'select' && !state.moved && !suppressTeleport && heldMs <= clickMaxDurationMs) {
                tryTeleport(inputSource);
            }

            dragState.delete(inputSource);
            movedInputs.delete(inputSource);
        };

        const handleSqueezeStart = () => {
            beginDrag('squeeze');
        };

        const handleSqueezeEnd = () => {
            const state = dragState.get(inputSource);
            if (!state) {
                return;
            }
            dragState.delete(inputSource);
        };

        inputSource.on('selectstart', handleSelectStart);
        inputSource.on('selectend', handleSelectEnd);
        inputSource.on('squeezestart', handleSqueezeStart);
        inputSource.on('squeezeend', handleSqueezeEnd);
        inputHandlers.set(inputSource, {
            handleSelectStart,
            handleSelectEnd,
            handleSqueezeStart,
            handleSqueezeEnd
        });
    });

    app.xr.input.on('remove', (inputSource) => {
        const handlers = inputHandlers.get(inputSource);
        if (handlers) {
            inputSource.off('selectstart', handlers.handleSelectStart);
            inputSource.off('selectend', handlers.handleSelectEnd);
            inputSource.off('squeezestart', handlers.handleSqueezeStart);
            inputSource.off('squeezeend', handlers.handleSqueezeEnd);
            inputHandlers.delete(inputSource);
        }
        dragState.delete(inputSource);
    });

    app.on('update', () => {
        if (!app.xr.active) {
            return;
        }

        for (const [inputSource, state] of dragState) {
            const origin = getDragOrigin(inputSource);
            if (!origin) {
                continue;
            }

            if (!state.active) {
                state.startOrigin.copy(origin);
                state.startHeight = parent.getPosition().y;
                state.active = true;
                continue;
            }

            const deltaY = origin.y - state.startOrigin.y;
            if (!state.moved && Math.abs(deltaY) >= dragMoveThreshold) {
                state.moved = true;
                movedInputs.add(inputSource);
            }
            if (!state.dragging && Math.abs(deltaY) >= dragStartThreshold) {
                state.dragging = true;
            }

            if (state.dragging) {
                parentPos.copy(parent.getPosition());
                parent.setPosition(parentPos.x, state.startHeight + deltaY, parentPos.z);
            }
        }
    });

    const start = (type: string) => {
        camera.camera.nearClip = 0.01;
        camera.camera.farClip = 1000;
        app.xr.start(app.root.findComponent('camera') as CameraComponent, type, 'local-floor');
    };

    events.on('startAR', () => start('immersive-ar'));
    events.on('startVR', () => start('immersive-vr'));

    events.on('inputEvent', (event) => {
        if (event === 'cancel' && app.xr.active) {
            app.xr.end();
        }
    });
};

export { initXr };
