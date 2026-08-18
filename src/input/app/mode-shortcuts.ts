import type { Global } from '../../types';

import type { PointerLockManager } from './pointer-lock';

const isCaptureMode = (mode: string) => mode === 'walk' || mode === 'fly';

const isWasdKey = (event: KeyboardEvent) =>
    event.code === 'KeyW' || event.code === 'KeyA' || event.code === 'KeyS' || event.code === 'KeyD';

/**
 * Keyboard shortcuts that switch camera mode and toggle UI affordances.
 * Listens on `window` so the user can switch scene layers and use the viewer's
 * navigation shortcuts regardless of which element has focus.
 */
class ModeShortcuts {
    private _global: Global | null = null;

    private _pointerLock: PointerLockManager | null = null;

    private _onKeyDown = (event: KeyboardEvent) => {
        const global = this._global;
        if (!global) return;
        const { state, events } = global;

        if (event.key === 'Escape') {
            if (this._pointerLock?.recentlyExitedCapture) {
                // already handled by pointerlockchange
            } else if (isCaptureMode(state.cameraMode) && state.gamingControls && state.inputMode === 'desktop') {
                state.gamingControls = false;
            } else if (state.cameraMode === 'walk') {
                events.fire('inputEvent', 'exitWalk', event);
            } else {
                events.fire('inputEvent', 'cancel', event);
            }
            return;
        }

        if (event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }

        if (event.code === 'BracketLeft' || event.key === '[' || event.key === '{') {
            events.fire('inputEvent', 'prevTransformFrame', event);
            return;
        }
        if (event.code === 'BracketRight' || event.key === ']' || event.key === '}') {
            events.fire('inputEvent', 'nextTransformFrame', event);
            return;
        }

        switch (event.key) {
            case '1':
                if (state.hasSecondarySplat) {
                    events.fire('inputEvent', 'showSplat', 1, event);
                } else {
                    state.cameraMode = 'orbit';
                }
                break;
            case '2':
                if (state.hasSecondarySplat) {
                    events.fire('inputEvent', 'showSplat', 2, event);
                } else {
                    state.cameraMode = 'fly';
                }
                break;
            case '3':
                if (state.hasDifferenceOverlay) {
                    events.fire('inputEvent', 'toggleDifferenceOverlay', event);
                } else {
                    events.fire('inputEvent', 'toggleWalk');
                }
                break;
            case 'p':
            case 'P':
                events.fire('inputEvent', 'gotoNearestTransformFrame', event);
                break;
            case 'v':
                if (state.hasCollisionOverlay) {
                    state.collisionOverlayEnabled = !state.collisionOverlayEnabled;
                }
                break;
            case 'g':
                state.gamingControls = !state.gamingControls;
                break;
            case 'h':
                events.fire('inputEvent', 'toggleHelp');
                break;
            case 'r':
                events.fire('inputEvent', 'reset', event);
                break;
            default:
                // Match the pre-merge behavior: WASD enters pointer-captured
                // gaming controls only in walk mode. In orbit/fly, keyboard
                // movement remains available without trapping the pointer or
                // permanently hiding the UI.
                if (
                    isWasdKey(event) &&
                    state.inputMode === 'desktop' &&
                    state.cameraMode === 'walk' &&
                    !state.gamingControls
                ) {
                    state.gamingControls = true;
                }
                break;
        }

        if (state.cameraMode !== 'walk') {
            switch (event.key) {
                case 'f':
                    events.fire('inputEvent', 'frame', event);
                    break;
                case ' ':
                    events.fire('inputEvent', 'playPause', event);
                    break;
            }
        }
    };

    attach(global: Global, pointerLock: PointerLockManager): void {
        this._global = global;
        this._pointerLock = pointerLock;
        window.addEventListener('keydown', this._onKeyDown);
    }

    detach(): void {
        window.removeEventListener('keydown', this._onKeyDown);
        this._global = null;
        this._pointerLock = null;
    }
}

export { ModeShortcuts };
