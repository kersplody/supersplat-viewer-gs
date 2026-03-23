import { EventHandler } from 'playcanvas';

import type { Annotation } from './settings';
import { Tooltip } from './tooltip';
import { Global } from './types';

// Initialize the touch joystick for fly mode camera control
const initJoystick = (
    dom: Record<string, HTMLElement>,
    events: EventHandler,
    state: { cameraMode: string; inputMode: string; gamingControls: boolean }
) => {
    // Joystick dimensions (matches SCSS: base height=100, stick size=40)
    const joystickHeight = 100;
    const stickSize = 40;
    const stickCenterY = (joystickHeight - stickSize) / 2; // 30px - top position when centered
    const stickCenterX = (joystickHeight - stickSize) / 2; // 30px - left position when centered (for 2D mode)
    const maxStickTravel = stickCenterY; // can travel 30px up or down from center

    // Fixed joystick position (bottom-left corner with safe area)
    const joystickFixedX = 70;
    const joystickFixedY = () => window.innerHeight - 140;

    // Joystick touch state
    let joystickPointerId: number | null = null;
    let joystickValueX = 0; // -1 to 1, negative = left, positive = right
    let joystickValueY = 0; // -1 to 1, negative = forward, positive = backward

    // Joystick mode: '1d' for vertical only, '2d' for full directional
    let joystickMode: '1d' | '2d' = '2d';

    // Double-tap detection for mode toggle
    let lastTapTime = 0;

    // Update joystick visibility based on camera mode and input mode
    const updateJoystickVisibility = () => {
        if ((state.cameraMode === 'fly' || state.cameraMode === 'walk') && state.inputMode === 'touch' && state.gamingControls) {
            dom.joystickBase.classList.remove('hidden');
            dom.joystickBase.classList.toggle('mode-2d', joystickMode === '2d');
            dom.joystickBase.style.left = `${joystickFixedX}px`;
            dom.joystickBase.style.top = `${joystickFixedY()}px`;
            // Center the stick
            dom.joystick.style.top = `${stickCenterY}px`;
            if (joystickMode === '2d') {
                dom.joystick.style.left = `${stickCenterX}px`;
            } else {
                dom.joystick.style.left = '8px'; // Reset to 1D centered position
            }
        } else {
            dom.joystickBase.classList.add('hidden');
        }
    };

    events.on('cameraMode:changed', updateJoystickVisibility);
    events.on('inputMode:changed', updateJoystickVisibility);
    events.on('gamingControls:changed', updateJoystickVisibility);
    window.addEventListener('resize', updateJoystickVisibility);

    // Handle joystick touch input directly on the joystick element
    const updateJoystickStick = (clientX: number, clientY: number) => {
        const baseY = joystickFixedY();
        // Calculate Y offset from joystick center (positive = down/backward)
        const offsetY = clientY - baseY;
        // Clamp to max travel and normalize to -1 to 1
        const clampedOffsetY = Math.max(-maxStickTravel, Math.min(maxStickTravel, offsetY));
        joystickValueY = clampedOffsetY / maxStickTravel;

        // Update stick visual Y position
        dom.joystick.style.top = `${stickCenterY + clampedOffsetY}px`;

        // Handle X axis in 2D mode
        if (joystickMode === '2d') {
            const baseX = joystickFixedX;
            const offsetX = clientX - baseX;
            const clampedOffsetX = Math.max(-maxStickTravel, Math.min(maxStickTravel, offsetX));
            joystickValueX = clampedOffsetX / maxStickTravel;

            // Update stick visual X position
            dom.joystick.style.left = `${stickCenterX + clampedOffsetX}px`;
        } else {
            joystickValueX = 0;
        }

        // Fire input event for the input controller
        events.fire('joystickInput', { x: joystickValueX, y: joystickValueY });
    };

    dom.joystickBase.addEventListener('pointerdown', (event: PointerEvent) => {
        // Double-tap detection for mode toggle
        const now = Date.now();
        if (now - lastTapTime < 300) {
            joystickMode = joystickMode === '1d' ? '2d' : '1d';
            updateJoystickVisibility();
            lastTapTime = 0;
        } else {
            lastTapTime = now;
        }

        if (joystickPointerId !== null) return; // Already tracking a touch

        joystickPointerId = event.pointerId;
        dom.joystickBase.setPointerCapture(event.pointerId);

        updateJoystickStick(event.clientX, event.clientY);
        event.preventDefault();
        event.stopPropagation();
    });

    dom.joystickBase.addEventListener('pointermove', (event: PointerEvent) => {
        if (event.pointerId !== joystickPointerId) return;

        updateJoystickStick(event.clientX, event.clientY);
        event.preventDefault();
    });

    const endJoystickTouch = (event: PointerEvent) => {
        if (event.pointerId !== joystickPointerId) return;

        joystickPointerId = null;
        joystickValueX = 0;
        joystickValueY = 0;

        // Reset stick to center
        dom.joystick.style.top = `${stickCenterY}px`;
        if (joystickMode === '2d') {
            dom.joystick.style.left = `${stickCenterX}px`;
        }

        // Fire input event with zero values
        events.fire('joystickInput', { x: 0, y: 0 });

        dom.joystickBase.releasePointerCapture(event.pointerId);
    };

    dom.joystickBase.addEventListener('pointerup', endJoystickTouch);
    dom.joystickBase.addEventListener('pointercancel', endJoystickTouch);
};

// Initialize the annotation navigator for stepping between annotations
const initAnnotationNav = (
    dom: Record<string, HTMLElement>,
    events: EventHandler,
    state: { loaded: boolean; inputMode: string; controlsHidden: boolean; annotationsVisible: boolean },
    annotations: Annotation[]
) => {
    // Only show navigator when there are at least 2 annotations
    if (annotations.length < 2) return;

    let currentIndex = 0;

    const updateDisplay = () => {
        dom.annotationNavTitle.textContent = annotations[currentIndex].title || '';
    };

    const updateMode = () => {
        if (!state.loaded) return;
        dom.annotationNav.classList.remove('desktop', 'touch', 'hidden');
        dom.annotationNav.classList.add(state.inputMode);
    };

    const updateFade = () => {
        if (!state.loaded) return;
        const hidden = state.controlsHidden || !state.annotationsVisible;
        dom.annotationNav.classList.toggle('faded-in', !hidden);
        dom.annotationNav.classList.toggle('faded-out', hidden);
    };

    const goTo = (index: number) => {
        currentIndex = index;
        updateDisplay();
        events.fire('annotation.navigate', annotations[currentIndex]);
    };

    // Prev / Next
    dom.annotationPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        goTo((currentIndex - 1 + annotations.length) % annotations.length);
    });

    dom.annotationNext.addEventListener('click', (e) => {
        e.stopPropagation();
        goTo((currentIndex + 1) % annotations.length);
    });

    // Sync when an annotation is activated externally (e.g. hotspot click)
    events.on('annotation.activate', (annotation: Annotation) => {
        if (!state.annotationsVisible) return;
        const idx = annotations.indexOf(annotation);
        if (idx !== -1) {
            currentIndex = idx;
            updateDisplay();
        }
    });

    // React to state changes
    events.on('loaded:changed', () => {
        updateMode();
        updateFade();
    });
    events.on('inputMode:changed', updateMode);
    events.on('controlsHidden:changed', updateFade);
    events.on('annotationsVisible:changed', updateFade);

    // Initial state
    updateDisplay();
};

// update the poster image to start blurry and then resolve to sharp during loading
const initPoster = (events: EventHandler) => {
    const poster = document.getElementById('poster');

    events.on('loaded:changed', () => {
        poster.style.display = 'none';
        document.documentElement.style.setProperty('--canvas-opacity', '1');
    });

    const blur = (progress: number) => {
        poster.style.filter = `blur(${Math.floor((100 - progress) * 0.4)}px)`;
    };

    events.on('progress:changed', blur);
};

const normalizeImdatCommon = (imdat: any): Record<string, any> | null => {
    if (!imdat || typeof imdat !== 'object') {
        return null;
    }

    if (typeof imdat.header?.common === 'object') {
        return imdat.header.common as Record<string, any>;
    }

    const common: Record<string, any> = {};
    const copyIfPresent = (targetKey: string, sourceKey: string) => {
        const value = imdat[sourceKey];
        if (value !== undefined && value !== null && value !== '') {
            common[targetKey] = value;
        }
    };

    copyIfPresent('dc:identifier', 'flightId');
    copyIfPresent('geoswarm:missionId', 'missionId');
    copyIfPresent('geoswarm:customer', 'customer');
    copyIfPresent('geoswarm:control', 'control');
    copyIfPresent('geoswarm:DateTimeCaptureStart', 'dateTimeCaptureStart');
    copyIfPresent('geoswarm:DateTimeCaptureEnd', 'dateTimeCaptureEnd');
    copyIfPresent('geoswarm:ellipsoid', 'ellipsoid');
    copyIfPresent('geoswarm:crs', 'crs');

    return Object.keys(common).length > 0 ? common : null;
};

const normalizeImdatPhotos = (imdat: any): Record<string, Record<string, any>> | null => {
    if (!imdat || typeof imdat !== 'object') {
        return null;
    }

    if (typeof imdat.photos === 'object' && imdat.photos) {
        return imdat.photos as Record<string, Record<string, any>>;
    }

    if (typeof imdat.images === 'object' && imdat.images) {
        return imdat.images as Record<string, Record<string, any>>;
    }

    return null;
};

const initUI = (global: Global) => {
    const { config, events, state } = global;

    // Acquire Elements
    const docRoot = document.documentElement;
    const dom = [
        'ui',
        'flightMetadataTop',
        'pipFrameWrap', 'pipFrameThumb', 'pipFrameFullscreen', 'pipFrameFull', 'pipPrevTransformFrame', 'pipNextTransformFrame', 'pipMetadataToggle', 'pipMetadataPanel',
        'controlsWrap',
        'arMode', 'vrMode',
        'enterFullscreen', 'exitFullscreen',
        'info', 'prevTransformFrame', 'nextTransformFrame', 'infoPanel', 'desktopTab', 'touchTab', 'desktopInfoPanel', 'touchInfoPanel',
        'timelineContainer', 'handle', 'time',
        'buttonContainer',
        'play', 'pause',
        'settings', 'settingsPanel',
        'orbitCamera', 'flyCamera', 'fpsCamera',
        'retinaDisplayRow', 'retinaDisplayCheck', 'retinaDisplayOption',
        'gamingControlsDivider', 'gamingControlsRow', 'gamingControlsCheck', 'gamingControlsOption',
        'desktopClickToWalk', 'desktopGamingControls',
        'touchFlyClickToWalk', 'touchFlyGamingControls',
        'touchClickToWalk', 'touchGamingControls',
        'walkHint',
        'reset', 'frame',
        'loadingText', 'loadingBar',
        'joystickBase', 'joystick',
        'showVoxels', 'showAnnotations',
        'tooltip',
        'annotationNav', 'annotationPrev', 'annotationNext', 'annotationInfo', 'annotationNavTitle',
        'supersplatBranding', 'logoOverlay'
    ].reduce((acc: Record<string, HTMLElement>, id) => {
        acc[id] = document.getElementById(id);
        return acc;
    }, {});

    // Remove focus from buttons after click so keyboard input isn't captured by the UI
    dom.ui.addEventListener('click', () => {
        (document.activeElement as HTMLElement)?.blur();
    });

    // Forward wheel events from UI overlays to the canvas so the camera zooms
    // instead of the page scrolling (e.g. annotation nav, tooltips, hotspots)
    const canvas = global.app.graphicsDevice.canvas as HTMLCanvasElement;
    dom.ui.addEventListener('wheel', (event: WheelEvent) => {
        canvas.dispatchEvent(new WheelEvent(event.type, event));
    }, { passive: true });

    const thumbImage = dom.pipFrameThumb as HTMLImageElement;
    const fullImage = dom.pipFrameFull as HTMLImageElement;
    const pipPrevTransformFrame = dom.pipPrevTransformFrame as HTMLButtonElement;
    const pipNextTransformFrame = dom.pipNextTransformFrame as HTMLButtonElement;
    const pipMetadataToggle = dom.pipMetadataToggle as HTMLButtonElement;
    const pipMetadataPanel = dom.pipMetadataPanel;
    const flightMetadataTop = dom.flightMetadataTop;
    const imdatPhotos = normalizeImdatPhotos(global.imdat);
    const imdatHeaderCommon = normalizeImdatCommon(global.imdat);
    const hasFramePreviews = global.settings.hasFramePreviews === true;
    const hasTransformFrames = Array.isArray(global.transforms?.frames) && global.transforms.frames.length > 0;
    let selectedFramePath: string | null = null;
    let fullscreenOpen = false;
    let pipZoomScale = 1;
    let pipPanX = 0;
    let pipPanY = 0;
    let suppressCloseClickUntil = 0;
    let suppressOpenClickUntil = 0;
    let pipMetadataOpen = false;
    let pipMetadataText = '';
    const pipMinZoom = 1;
    const pipMaxZoom = 8;
    const pipCloseClickSuppressMs = 250;
    const pipOpenClickSuppressMs = 300;
    const activeTouchPoints = new Map<number, { x: number; y: number }>();
    let gestureStartDistance: number | null = null;
    let gestureStartScale = 1;
    let gestureStartPanX = 0;
    let gestureStartPanY = 0;
    let gestureStartMidX = 0;
    let gestureStartMidY = 0;
    let touchGestureDidMove = false;
    let touchTapPointerId: number | null = null;
    let touchTapStartX = 0;
    let touchTapStartY = 0;
    let touchTapIsCandidate = false;
    let mousePanPointerId: number | null = null;
    let mousePanStartX = 0;
    let mousePanStartY = 0;
    let mousePanBaseX = 0;
    let mousePanBaseY = 0;
    let mousePanDidMove = false;
    let hasStoredPipView = false;
    const isAnimationRunning = () => state.cameraMode === 'anim' && !state.animationPaused;

    const toDerivedFramePath = (filePath: string, directory: 'images_jpg_8' | 'images_jpg') => {
        const withDirectory = filePath.replace(/(^|\/)images\//i, `$1${directory}/`);
        return withDirectory.replace(/\.[^./\\]+$/, '.jpg');
    };

    const normalizeCaptureDateTime = (value: any) => {
        if (typeof value !== 'string' || !value) {
            return null;
        }
        return value.replace(/^(\d{4}):(\d{2}):(\d{2})\s/, '$1-$2-$3 ');
    };

    const pickFlightDateTime = () => {
        const captureStart = imdatHeaderCommon?.['geoswarm:DateTimeCaptureStart'];
        return normalizeCaptureDateTime(captureStart);
    };

    const updateFlightMetadataTop = () => {
        if (!flightMetadataTop || !imdatHeaderCommon) {
            flightMetadataTop?.classList.add('hidden');
            return;
        }

        const flightId = imdatHeaderCommon['dc:identifier'];
        const missionId = imdatHeaderCommon['geoswarm:missionId'];
        const customer = imdatHeaderCommon['geoswarm:customer'];
        const control = imdatHeaderCommon['geoswarm:control'];
        const flightDateTime = pickFlightDateTime();

        const line1Parts = [
            flightId ? `FlightId: ${flightId}` : null,
            missionId ? `MissionID: ${missionId}` : null
        ].filter(Boolean);
        const line2Parts = [
            customer ? `Customer: ${customer}` : null,
            control ? `Control: ${control}` : null,
            flightDateTime ? `Flight: ${flightDateTime}` : null
        ].filter(Boolean);

        const lines = [line1Parts.join('  |  '), line2Parts.join('  |  ')].filter(line => !!line);
        if (lines.length === 0) {
            flightMetadataTop.classList.add('hidden');
            flightMetadataTop.textContent = '';
            return;
        }

        flightMetadataTop.textContent = lines.join('\n');
        flightMetadataTop.classList.remove('hidden');
    };

    const updateFlightMetadataTopLayout = () => {
        if (!flightMetadataTop) {
            return;
        }

        const edgePad = 16;
        const gap = 12;
        let leftBound = edgePad;
        let rightBound = window.innerWidth - edgePad;

        if (!dom.pipFrameWrap.classList.contains('hidden')) {
            leftBound = Math.max(leftBound, dom.pipFrameWrap.getBoundingClientRect().right + gap);
        }

        const logoOverlay = dom.logoOverlay;
        if (logoOverlay) {
            rightBound = Math.min(rightBound, logoOverlay.getBoundingClientRect().left - gap);
        }

        if (rightBound - leftBound < 120) {
            leftBound = edgePad;
            rightBound = window.innerWidth - edgePad;
        }

        flightMetadataTop.style.left = `${Math.max(edgePad, leftBound)}px`;
        flightMetadataTop.style.right = `${Math.max(edgePad, window.innerWidth - rightBound)}px`;
    };

    const toFrameMetadata = (selection: { filePath?: string | null; colmapImId?: number | null } | null | undefined) => {
        if (!imdatPhotos || !selection?.filePath) {
            return null;
        }

        const filePath = selection.filePath;
        const baseName = filePath.split('/').pop() ?? filePath;
        const stem = baseName.replace(/\.[^./\\]+$/, '');
        const candidates = [
            filePath,
            filePath.replace(/^\.\//, ''),
            baseName,
            `${stem}.png`,
            `${stem}.jpg`,
            `${stem}.jpeg`,
            `images/${baseName}`,
            `orig_images/${baseName}`,
            String(selection.colmapImId ?? '')
        ].filter(Boolean);

        for (const key of candidates) {
            const metadata = imdatPhotos[key];
            if (metadata && typeof metadata === 'object') {
                return metadata;
            }
        }

        return null;
    };

    const renderMetadataValue = (value: any) => {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? `${value}` : '';
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        if (typeof value === 'string') {
            return value;
        }
        return JSON.stringify(value);
    };

    const shouldDisplayMetadataKey = (key: string) => !/(^|:)srtTags$/i.test(key);

    const updatePipMetadataUiVisibility = () => {
        const hasMetadata = !!pipMetadataText;
        pipMetadataToggle.classList.toggle('hidden', !fullscreenOpen || !hasMetadata);
        pipPrevTransformFrame.classList.toggle('hidden', !hasTransformFrames || !fullscreenOpen || !selectedFramePath);
        pipNextTransformFrame.classList.toggle('hidden', !hasTransformFrames || !fullscreenOpen || !selectedFramePath);
        pipMetadataPanel.classList.toggle('hidden', !(fullscreenOpen && hasMetadata && pipMetadataOpen));
        if (fullscreenOpen && hasMetadata && pipMetadataOpen) {
            pipMetadataPanel.textContent = pipMetadataText;
        } else if (!pipMetadataOpen) {
            pipMetadataPanel.textContent = '';
        }
    };

    const isPipMetadataInteractiveTarget = (target: EventTarget | null) => {
        const node = target as Node | null;
        if (!node) {
            return false;
        }
        return pipMetadataToggle.contains(node) ||
            pipPrevTransformFrame.contains(node) ||
            pipNextTransformFrame.contains(node) ||
            pipMetadataPanel.contains(node);
    };

    const updatePipMetadataPanel = (selection: { filePath?: string | null; colmapImId?: number | null } | null | undefined) => {
        if (!pipMetadataPanel) {
            return;
        }

        const commonLines = Object.entries(imdatHeaderCommon ?? {})
        .filter(([key]) => shouldDisplayMetadataKey(key))
        .map(([key, value]) => {
            const rendered = renderMetadataValue(value);
            return rendered ? `${key}: ${rendered}` : null;
        })
        .filter((line): line is string => !!line);

        const metadata = toFrameMetadata(selection);
        const photoLines = Object.entries(metadata ?? {})
        .filter(([key]) => shouldDisplayMetadataKey(key))
        .map(([key, value]) => {
            const rendered = renderMetadataValue(value);
            return rendered ? `${key}: ${rendered}` : null;
        })
        .filter((line): line is string => !!line);

        const sections: string[] = [];
        if (commonLines.length > 0) {
            sections.push(['Common', ...commonLines].join('\n'));
        }
        if (photoLines.length > 0) {
            sections.push(['Photo', ...photoLines].join('\n'));
        }

        pipMetadataText = sections.join('\n\n');
        if (!pipMetadataText) {
            pipMetadataOpen = false;
            updatePipMetadataUiVisibility();
            return;
        }
        updatePipMetadataUiVisibility();
    };

    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    const applyPipTransform = () => {
        fullImage.style.transform = `translate(${pipPanX}px, ${pipPanY}px) scale(${pipZoomScale})`;
        emitPipInspectState(true);
    };

    const applyPipZoom = (nextScale: number) => {
        pipZoomScale = clamp(nextScale, pipMinZoom, pipMaxZoom);
        applyPipTransform();
    };

    const suppressPipCloseClick = () => {
        suppressCloseClickUntil = performance.now() + pipCloseClickSuppressMs;
    };

    const suppressPipOpenClick = () => {
        suppressOpenClickUntil = performance.now() + pipOpenClickSuppressMs;
    };

    const zoomPipAt = (clientX: number, clientY: number, nextScale: number) => {
        const clampedScale = clamp(nextScale, pipMinZoom, pipMaxZoom);
        if (clampedScale === pipZoomScale) {
            return;
        }

        const rect = fullImage.getBoundingClientRect();
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        const screenOffsetX = clientX - centerX;
        const screenOffsetY = clientY - centerY;
        const imageX = (screenOffsetX - pipPanX) / pipZoomScale;
        const imageY = (screenOffsetY - pipPanY) / pipZoomScale;

        pipPanX = screenOffsetX - imageX * clampedScale;
        pipPanY = screenOffsetY - imageY * clampedScale;
        pipZoomScale = clampedScale;
        applyPipTransform();
    };

    const resetPipInteractionState = () => {
        suppressCloseClickUntil = 0;
        mousePanPointerId = null;
        mousePanDidMove = false;
        touchGestureDidMove = false;
        touchTapPointerId = null;
        touchTapStartX = 0;
        touchTapStartY = 0;
        touchTapIsCandidate = false;
        activeTouchPoints.clear();
        gestureStartDistance = null;
        gestureStartScale = 1;
        gestureStartPanX = 0;
        gestureStartPanY = 0;
        gestureStartMidX = 0;
        gestureStartMidY = 0;
    };

    const resetStoredPipView = () => {
        hasStoredPipView = false;
        pipZoomScale = 1;
        pipPanX = 0;
        pipPanY = 0;
        applyPipTransform();
    };

    const getPipInspectState = () => {
        const naturalWidth = fullImage.naturalWidth;
        const naturalHeight = fullImage.naturalHeight;
        const rect = fullImage.getBoundingClientRect();
        if (!(naturalWidth > 0 && naturalHeight > 0 && rect.width > 0 && rect.height > 0)) {
            return null;
        }

        const baseDisplayWidth = rect.width / pipZoomScale;
        const baseDisplayHeight = rect.height / pipZoomScale;
        if (!(baseDisplayWidth > 0 && baseDisplayHeight > 0)) {
            return null;
        }

        const viewportCenterX = window.innerWidth * 0.5;
        const viewportCenterY = window.innerHeight * 0.5;
        const transformedCenterX = rect.left + rect.width * 0.5;
        const transformedCenterY = rect.top + rect.height * 0.5;
        const centerOffsetX = viewportCenterX - transformedCenterX;
        const centerOffsetY = viewportCenterY - transformedCenterY;
        const pixelsPerImageX = baseDisplayWidth / naturalWidth;
        const pixelsPerImageY = baseDisplayHeight / naturalHeight;
        const centerU = naturalWidth * 0.5 + centerOffsetX / (pipZoomScale * pixelsPerImageX);
        const centerV = naturalHeight * 0.5 + centerOffsetY / (pipZoomScale * pixelsPerImageY);

        return {
            zoom: pipZoomScale,
            panX: pipPanX,
            panY: pipPanY,
            imageWidth: baseDisplayWidth,
            imageHeight: baseDisplayHeight,
            sourceWidth: naturalWidth,
            sourceHeight: naturalHeight,
            centerU,
            centerV
        };
    };

    const closeFullscreenFrame = () => {
        if (!fullscreenOpen) {
            return;
        }
        fullscreenOpen = false;
        dom.pipFrameFullscreen.classList.add('hidden');
        suppressPipOpenClick();
        resetPipInteractionState();
        hasStoredPipView = true;
        emitPipInspectState(false);

        // Explicitly release full-resolution image memory when closed.
        fullImage.removeAttribute('src');
        if (flightMetadataTop?.textContent) {
            flightMetadataTop.classList.remove('hidden');
        }
        pipMetadataOpen = false;
        updatePipMetadataUiVisibility();
    };

    const clearPipFrameSelection = () => {
        selectedFramePath = null;
        thumbImage.removeAttribute('src');
        fullImage.removeAttribute('src');
        pipMetadataText = '';
        pipMetadataOpen = false;
        updatePipMetadataUiVisibility();
    };

    const updatePipVisibility = () => {
        const shouldShow = hasFramePreviews && !!selectedFramePath && !isAnimationRunning();
        dom.pipFrameWrap.classList[shouldShow ? 'remove' : 'add']('hidden');
        updateFlightMetadataTopLayout();
        if (!shouldShow) {
            closeFullscreenFrame();
        }
    };

    const openFullscreenFrame = () => {
        if (!selectedFramePath) {
            return;
        }
        fullscreenOpen = true;
        dom.pipFrameFullscreen.classList.remove('hidden');
        resetPipInteractionState();
        if (!hasStoredPipView) {
            pipZoomScale = 1;
            pipPanX = 0;
            pipPanY = 0;
        }
        applyPipTransform();
        fullImage.src = toDerivedFramePath(selectedFramePath, 'images_jpg');
        flightMetadataTop?.classList.add('hidden');
        pipMetadataOpen = false;
        updatePipMetadataUiVisibility();
        emitPipInspectState(true);
    };

    function emitPipInspectState(active: boolean) {
        if (!active || !fullscreenOpen) {
            events.fire('pipInspect:changed', { active: false });
            return;
        }

        const inspectState = getPipInspectState();
        if (!inspectState) {
            return;
        }

        events.fire('pipInspect:changed', {
            active: true,
            ...inspectState
        });
    }

    const toggleFullscreenFrame = () => {
        if (fullscreenOpen) {
            closeFullscreenFrame();
        } else {
            openFullscreenFrame();
        }
    };

    dom.pipFrameWrap.addEventListener('click', (event) => {
        if (performance.now() < suppressOpenClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.stopPropagation();
        if (!fullscreenOpen) {
            events.fire('inputEvent', 'gotoCurrentTransformFrame', event);
        }
        toggleFullscreenFrame();
    });

    window.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) {
            return;
        }
        if (event.key === 'z' || event.key === 'Z') {
            if (dom.pipFrameWrap.classList.contains('hidden') && !fullscreenOpen) {
                return;
            }
            if (!fullscreenOpen) {
                events.fire('inputEvent', 'gotoCurrentTransformFrame', event);
            }
            toggleFullscreenFrame();
            event.preventDefault();
        }
    });

    fullImage.addEventListener('load', () => {
        if (fullscreenOpen) {
            emitPipInspectState(true);
        }
    });

    dom.pipFrameFullscreen.addEventListener('wheel', (event: WheelEvent) => {
        if (!fullscreenOpen) {
            return;
        }
        event.stopPropagation();
        const zoomFactor = Math.exp(-event.deltaY * 0.0015);
        zoomPipAt(event.clientX, event.clientY, pipZoomScale * zoomFactor);
    }, { passive: true });

    dom.pipFrameFullscreen.addEventListener('pointerdown', (event: PointerEvent) => {
        if (!fullscreenOpen) {
            return;
        }
        if (isPipMetadataInteractiveTarget(event.target)) {
            return;
        }

        if (event.pointerType === 'mouse' && event.button === 0) {
            mousePanPointerId = event.pointerId;
            mousePanStartX = event.clientX;
            mousePanStartY = event.clientY;
            mousePanBaseX = pipPanX;
            mousePanBaseY = pipPanY;
            mousePanDidMove = false;
            dom.pipFrameFullscreen.setPointerCapture(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.pointerType !== 'touch') {
            return;
        }

        activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (activeTouchPoints.size === 1) {
            touchTapPointerId = event.pointerId;
            touchTapStartX = event.clientX;
            touchTapStartY = event.clientY;
            touchTapIsCandidate = true;
        } else {
            touchTapIsCandidate = false;
        }
        if (activeTouchPoints.size === 2) {
            const [a, b] = Array.from(activeTouchPoints.values());
            gestureStartDistance = Math.hypot(a.x - b.x, a.y - b.y);
            gestureStartScale = pipZoomScale;
            gestureStartPanX = pipPanX;
            gestureStartPanY = pipPanY;
            gestureStartMidX = (a.x + b.x) * 0.5;
            gestureStartMidY = (a.y + b.y) * 0.5;
            touchGestureDidMove = false;
        }
        event.preventDefault();
        event.stopPropagation();
    });

    dom.pipFrameFullscreen.addEventListener('pointermove', (event: PointerEvent) => {
        if (!fullscreenOpen) {
            return;
        }

        if (event.pointerType === 'mouse' && event.pointerId === mousePanPointerId) {
            const deltaX = event.clientX - mousePanStartX;
            const deltaY = event.clientY - mousePanStartY;
            if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
                mousePanDidMove = true;
            }
            pipPanX = mousePanBaseX + deltaX;
            pipPanY = mousePanBaseY + deltaY;
            applyPipTransform();
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.pointerType !== 'touch' || !activeTouchPoints.has(event.pointerId)) {
            return;
        }

        activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (event.pointerId === touchTapPointerId && touchTapIsCandidate) {
            if (Math.abs(event.clientX - touchTapStartX) > 6 || Math.abs(event.clientY - touchTapStartY) > 6) {
                touchTapIsCandidate = false;
            }
        }
        if (activeTouchPoints.size < 2 || gestureStartDistance === null || gestureStartDistance <= 0) {
            return;
        }

        const [a, b] = Array.from(activeTouchPoints.values());
        const currentDistance = Math.hypot(a.x - b.x, a.y - b.y);
        if (currentDistance <= 0) {
            return;
        }

        const currentMidX = (a.x + b.x) * 0.5;
        const currentMidY = (a.y + b.y) * 0.5;
        if (Math.abs(currentMidX - gestureStartMidX) > 1 ||
            Math.abs(currentMidY - gestureStartMidY) > 1 ||
            Math.abs(currentDistance - gestureStartDistance) > 1) {
            touchGestureDidMove = true;
        }
        pipPanX = gestureStartPanX + (currentMidX - gestureStartMidX);
        pipPanY = gestureStartPanY + (currentMidY - gestureStartMidY);
        applyPipZoom(gestureStartScale * (currentDistance / gestureStartDistance));
        event.preventDefault();
        event.stopPropagation();
    });

    const releaseTouchPoint = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && event.pointerId === mousePanPointerId) {
            mousePanPointerId = null;
            if (mousePanDidMove) {
                suppressPipCloseClick();
            }
            if (dom.pipFrameFullscreen.hasPointerCapture(event.pointerId)) {
                dom.pipFrameFullscreen.releasePointerCapture(event.pointerId);
            }
            return;
        }

        if (event.pointerType !== 'touch') {
            return;
        }

        activeTouchPoints.delete(event.pointerId);
        if (activeTouchPoints.size < 2) {
            gestureStartDistance = null;
            gestureStartScale = pipZoomScale;
            gestureStartPanX = pipPanX;
            gestureStartPanY = pipPanY;
            if (touchGestureDidMove) {
                suppressPipCloseClick();
            }
        }

        if (event.pointerId === touchTapPointerId) {
            const shouldCloseFromTap =
                touchTapIsCandidate &&
                activeTouchPoints.size === 0 &&
                performance.now() >= suppressCloseClickUntil;
            touchTapPointerId = null;
            touchTapIsCandidate = false;
            if (shouldCloseFromTap) {
                event.preventDefault();
                event.stopPropagation();
                closeFullscreenFrame();
            }
        }
    };

    dom.pipFrameFullscreen.addEventListener('pointerup', releaseTouchPoint);
    dom.pipFrameFullscreen.addEventListener('pointercancel', releaseTouchPoint);

    dom.pipFrameFullscreen.addEventListener('click', (event) => {
        if (isPipMetadataInteractiveTarget(event.target)) {
            event.stopPropagation();
            return;
        }
        event.stopPropagation();
        if (performance.now() < suppressCloseClickUntil) {
            return;
        }
        closeFullscreenFrame();
    });

    pipMetadataToggle.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
    });
    pipMetadataToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!pipMetadataText) {
            return;
        }
        pipMetadataOpen = !pipMetadataOpen;
        updatePipMetadataUiVisibility();
    });

    pipMetadataPanel.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
    });
    pipMetadataPanel.addEventListener('click', (event) => {
        event.stopPropagation();
    });
    pipMetadataPanel.addEventListener('wheel', (event) => {
        event.stopPropagation();
    }, { passive: true });

    pipPrevTransformFrame.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
    });
    pipPrevTransformFrame.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        events.fire('inputEvent', 'prevTransformFrame', event);
    });

    pipNextTransformFrame.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
    });
    pipNextTransformFrame.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        events.fire('inputEvent', 'nextTransformFrame', event);
    });

    events.on('transformFrame:selected', (selection) => {
        if (!hasFramePreviews) {
            clearPipFrameSelection();
            updatePipVisibility();
            return;
        }

        const filePath = selection?.filePath as string | null;
        if (!filePath) {
            clearPipFrameSelection();
            return;
        }

        selectedFramePath = filePath;
        thumbImage.src = toDerivedFramePath(filePath, 'images_jpg_8');
        updatePipMetadataPanel(selection);

        if (fullscreenOpen) {
            fullImage.src = toDerivedFramePath(filePath, 'images_jpg');
        }

        updatePipVisibility();
    });

    events.on('cameraMode:changed', updatePipVisibility);
    events.on('animationPaused:changed', updatePipVisibility);
    events.on('transformFrame:nearestUpdated', () => {
        if (!fullscreenOpen) {
            resetStoredPipView();
        }
    });

    // Handle loading progress updates
    events.on('progress:changed', (progress) => {
        dom.loadingText.textContent = `${progress}%`;
        if (progress < 100) {
            dom.loadingBar.style.backgroundImage = `linear-gradient(90deg, #F60 0%, #F60 ${progress}%, white ${progress}%, white 100%)`;
        } else {
            dom.loadingBar.style.backgroundImage = 'linear-gradient(90deg, #F60 0%, #F60 100%)';
        }
    });

    // Hide loading bar once loaded
    events.on('loaded:changed', () => {
        document.getElementById('loadingWrap').classList.add('hidden');
    });

    // Fullscreen support
    const hasFullscreenAPI = docRoot.requestFullscreen && document.exitFullscreen;

    const requestFullscreen = () => {
        if (hasFullscreenAPI) {
            docRoot.requestFullscreen();
        } else {
            window.parent.postMessage('requestFullscreen', '*');
            state.isFullscreen = true;
        }
    };

    const exitFullscreen = () => {
        if (hasFullscreenAPI) {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        } else {
            window.parent.postMessage('exitFullscreen', '*');
            state.isFullscreen = false;
        }
    };

    if (hasFullscreenAPI) {
        document.addEventListener('fullscreenchange', () => {
            state.isFullscreen = !!document.fullscreenElement;
        });
    }

    dom.enterFullscreen.addEventListener('click', requestFullscreen);
    dom.exitFullscreen.addEventListener('click', exitFullscreen);

    // toggle fullscreen when user switches between landscape portrait
    // orientation
    screen?.orientation?.addEventListener('change', (event) => {
        if (['landscape-primary', 'landscape-secondary'].includes(screen.orientation.type)) {
            requestFullscreen();
        } else {
            exitFullscreen();
        }
    });

    // update UI when fullscreen state changes
    events.on('isFullscreen:changed', (value) => {
        dom.enterFullscreen.classList[value ? 'add' : 'remove']('hidden');
        dom.exitFullscreen.classList[value ? 'remove' : 'add']('hidden');
    });

    // Retina display toggle
    dom.retinaDisplayRow.addEventListener('click', () => {
        state.retinaDisplay = !state.retinaDisplay;
    });

    const updateRetinaDisplay = () => {
        dom.retinaDisplayCheck.classList.toggle('active', state.retinaDisplay);
        localStorage.setItem('retinaDisplay', String(state.retinaDisplay));
    };
    events.on('retinaDisplay:changed', updateRetinaDisplay);
    updateRetinaDisplay();

    // Gaming mode toggle (settings row visible on mobile only)
    dom.gamingControlsRow.addEventListener('click', () => {
        state.gamingControls = !state.gamingControls;
    });

    const updateGamingSettingsVisibility = () => {
        const isDesktop = state.inputMode === 'desktop';
        dom.gamingControlsDivider.classList.toggle('hidden', isDesktop);
        dom.gamingControlsRow.classList.toggle('hidden', isDesktop);
    };
    events.on('inputMode:changed', updateGamingSettingsVisibility);
    updateGamingSettingsVisibility();

    const updateGamingControls = () => {
        dom.gamingControlsCheck.classList.toggle('active', state.gamingControls);
        if (state.inputMode !== 'desktop') {
            dom.desktopClickToWalk.classList.toggle('hidden', state.gamingControls);
            dom.desktopGamingControls.classList.toggle('hidden', !state.gamingControls);
        }
        dom.touchFlyClickToWalk.classList.toggle('hidden', state.gamingControls);
        dom.touchFlyGamingControls.classList.toggle('hidden', !state.gamingControls);
        dom.touchClickToWalk.classList.toggle('hidden', state.gamingControls);
        dom.touchGamingControls.classList.toggle('hidden', !state.gamingControls);
        localStorage.setItem('gamingControls', String(state.gamingControls));
    };

    events.on('gamingControls:changed', updateGamingControls);
    updateGamingControls();

    // AR/VR
    const arChanged = () => dom.arMode.classList[state.hasAR ? 'remove' : 'add']('hidden');
    const vrChanged = () => dom.vrMode.classList[state.hasVR ? 'remove' : 'add']('hidden');

    dom.arMode.addEventListener('click', () => events.fire('startAR'));
    dom.vrMode.addEventListener('click', () => events.fire('startVR'));

    events.on('hasAR:changed', arChanged);
    events.on('hasVR:changed', vrChanged);

    arChanged();
    vrChanged();

    // Info panel
    const updateInfoTab = (tab: 'desktop' | 'touch') => {
        if (tab === 'desktop') {
            dom.desktopTab.classList.add('active');
            dom.touchTab.classList.remove('active');
            dom.desktopInfoPanel.classList.remove('hidden');
            dom.touchInfoPanel.classList.add('hidden');
        } else {
            dom.desktopTab.classList.remove('active');
            dom.touchTab.classList.add('active');
            dom.desktopInfoPanel.classList.add('hidden');
            dom.touchInfoPanel.classList.remove('hidden');
        }
    };

    dom.desktopTab.addEventListener('click', () => {
        updateInfoTab('desktop');
    });

    dom.touchTab.addEventListener('click', () => {
        updateInfoTab('touch');
    });

    const toggleHelp = () => {
        updateInfoTab(state.inputMode);
        dom.infoPanel.classList.toggle('hidden');
    };

    dom.info.addEventListener('click', toggleHelp);

    dom.infoPanel.addEventListener('pointerdown', () => {
        dom.infoPanel.classList.add('hidden');
    });

    events.on('inputEvent', (event) => {
        if (event === 'toggleHelp') {
            toggleHelp();
        } else if (event === 'cancel') {
            // close info panel on cancel
            dom.infoPanel.classList.add('hidden');
            dom.settingsPanel.classList.add('hidden');

            // close fullscreen on cancel
            if (state.isFullscreen) {
                exitFullscreen();
            }

            closeFullscreenFrame();
        } else if (event === 'interrupt') {
            dom.settingsPanel.classList.add('hidden');
        }
    });

    // fade ui controls after 5 seconds of inactivity
    events.on('controlsHidden:changed', (value) => {
        dom.controlsWrap.classList.toggle('faded-out', value);
        dom.controlsWrap.classList.toggle('faded-in', !value);
    });

    // show the ui and start a timer to hide it again
    let uiTimeout: ReturnType<typeof setTimeout> | null = null;
    let annotationVisible = false;

    const showUI = () => {
        if (uiTimeout) {
            clearTimeout(uiTimeout);
        }
        state.controlsHidden = false;
        uiTimeout = setTimeout(() => {
            uiTimeout = null;
            if (!annotationVisible) {
                state.controlsHidden = true;
            }
        }, 4000);
    };

    // Show controls once loaded
    events.on('loaded:changed', () => {
        dom.controlsWrap.classList.remove('hidden');
        showUI();
    });

    events.on('inputEvent', showUI);

    // keep UI visible while an annotation tooltip is shown
    events.on('annotation.activate', () => {
        annotationVisible = true;
        showUI();
    });

    events.on('annotation.deactivate', () => {
        annotationVisible = false;
        showUI();
    });

    // Animation controls
    events.on('hasAnimation:changed', (value, prev) => {
        // Start and Stop animation
        dom.play.addEventListener('click', () => {
            state.cameraMode = 'anim';
            state.animationPaused = false;
        });

        dom.pause.addEventListener('click', () => {
            state.cameraMode = 'anim';
            state.animationPaused = true;
        });

        const updatePlayPause = () => {
            if (state.cameraMode !== 'anim' || state.animationPaused) {
                dom.play.classList.remove('hidden');
                dom.pause.classList.add('hidden');
            } else {
                dom.play.classList.add('hidden');
                dom.pause.classList.remove('hidden');
            }

            if (state.cameraMode === 'anim') {
                dom.timelineContainer.classList.remove('hidden');
            } else {
                dom.timelineContainer.classList.add('hidden');
            }
        };

        // Update UI on animation changes
        events.on('cameraMode:changed', updatePlayPause);
        events.on('animationPaused:changed', updatePlayPause);

        const updateSlider = () => {
            dom.handle.style.left = `${state.animationTime / state.animationDuration * 100}%`;
            dom.time.style.left = `${state.animationTime / state.animationDuration * 100}%`;
            dom.time.innerText = `${state.animationTime.toFixed(1)}s`;
        };

        events.on('animationTime:changed', updateSlider);
        events.on('animationLength:changed', updateSlider);

        const handleScrub = (event: PointerEvent) => {
            const rect = dom.timelineContainer.getBoundingClientRect();
            const t = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left)) / rect.width;
            events.fire('scrubAnim', state.animationDuration * t);
            showUI();
        };

        let paused = false;
        let captured = false;

        dom.timelineContainer.addEventListener('pointerdown', (event: PointerEvent) => {
            if (!captured) {
                handleScrub(event);
                dom.timelineContainer.setPointerCapture(event.pointerId);
                dom.time.classList.remove('hidden');
                paused = state.animationPaused;
                state.animationPaused = true;
                captured = true;
            }
        });

        dom.timelineContainer.addEventListener('pointermove', (event: PointerEvent) => {
            if (captured) {
                handleScrub(event);
            }
        });

        dom.timelineContainer.addEventListener('pointerup', (event) => {
            if (captured) {
                dom.timelineContainer.releasePointerCapture(event.pointerId);
                dom.time.classList.add('hidden');
                state.animationPaused = paused;
                captured = false;
            }
        });
    });

    // Camera mode UI
    const updateCameraModeUI = () => {
        dom.orbitCamera.classList.toggle('active', state.cameraMode === 'orbit');
        dom.flyCamera.classList.toggle('active', state.cameraMode === 'fly');
        dom.fpsCamera.classList.toggle('active', state.cameraMode === 'walk');
    };

    events.on('cameraMode:changed', updateCameraModeUI);

    // Walk mode hint banner (shown once per session on first FPS entry)
    let walkHintShown = false;

    const getWalkHintText = () => {
        if (state.inputMode === 'desktop') {
            return 'Click to walk. WASD to move freely.';
        }
        return state.gamingControls ?
            'Use the joystick to move. Drag to look around. Tap to jump.' :
            'Tap to walk. Drag to look around.';
    };

    events.on('cameraMode:changed', (value: string) => {
        if (value === 'walk' && !walkHintShown) {
            walkHintShown = true;
            dom.walkHint.textContent = getWalkHintText();
            dom.walkHint.classList.remove('hidden');
        } else if (value !== 'walk') {
            dom.walkHint.classList.add('hidden');
        }
    });

    const dismissWalkHint = () => dom.walkHint.classList.add('hidden');

    dom.walkHint.addEventListener('click', dismissWalkHint);
    events.on('inputEvent', (type: string) => {
        if (type === 'interrupt') dismissWalkHint();
    });

    // show/hide the FPS button based on voxel data availability
    events.on('hasCollision:changed', (value: boolean) => {
        dom.fpsCamera.classList.toggle('hidden', !value);
        // adjust fly button shape: middle when FPS is visible, right when hidden
        dom.flyCamera.classList.toggle('middle', value);
        dom.flyCamera.classList.toggle('right', !value);
    });

    // Voxel overlay toggle (only visible when overlay is available)
    events.on('hasVoxelOverlay:changed', (value: boolean) => {
        dom.showVoxels.classList.toggle('hidden', !value);
    });

    dom.showVoxels.addEventListener('click', () => {
        state.voxelOverlayEnabled = !state.voxelOverlayEnabled;
    });

    events.on('voxelOverlayEnabled:changed', (value: boolean) => {
        dom.showVoxels.classList.toggle('active', value);
    });

    const showAnnotationsButton = dom.showAnnotations as HTMLButtonElement | null;
    if (showAnnotationsButton) {
        const hasAnnotations = global.settings.annotations.length > 0;
        showAnnotationsButton.classList.toggle('hidden', !hasAnnotations);

        showAnnotationsButton.addEventListener('click', () => {
            state.annotationsVisible = !state.annotationsVisible;
        });

        events.on('annotationsVisible:changed', (value: boolean) => {
            showAnnotationsButton.classList.toggle('active', value);
        });

        showAnnotationsButton.classList.toggle('active', state.annotationsVisible);
    }

    dom.settings.addEventListener('click', () => {
        dom.settingsPanel.classList.toggle('hidden');
    });

    dom.orbitCamera.addEventListener('click', () => {
        state.cameraMode = 'orbit';
    });

    dom.flyCamera.addEventListener('click', () => {
        state.cameraMode = 'fly';
    });

    dom.fpsCamera.addEventListener('click', () => {
        events.fire('inputEvent', 'toggleWalk');
    });

    dom.reset.addEventListener('click', (event) => {
        events.fire('inputEvent', 'reset', event);
    });

    dom.frame.addEventListener('click', (event) => {
        events.fire('inputEvent', 'frame', event);
    });

    dom.prevTransformFrame.classList.toggle('hidden', !hasTransformFrames);
    dom.nextTransformFrame.classList.toggle('hidden', !hasTransformFrames);

    dom.prevTransformFrame.addEventListener('click', (event) => {
        if (!hasTransformFrames) {
            return;
        }
        events.fire('inputEvent', 'prevTransformFrame', event);
    });

    dom.nextTransformFrame.addEventListener('click', (event) => {
        if (!hasTransformFrames) {
            return;
        }
        events.fire('inputEvent', 'nextTransformFrame', event);
    });

    // Initialize touch joystick for fly mode
    initJoystick(dom, events, state);

    // Initialize annotation navigator
    initAnnotationNav(dom, events, state, global.settings.annotations);

    // Hide all UI (poster, loading bar, controls)
    if (config.noui) {
        dom.ui.classList.add('hidden');
    }

    // tooltips
    const tooltip = new Tooltip(dom.tooltip);

    tooltip.register(dom.play, 'Play', 'top');
    tooltip.register(dom.pause, 'Pause', 'top');
    tooltip.register(dom.orbitCamera, 'Orbit Camera', 'top');
    tooltip.register(dom.flyCamera, 'Fly Camera', 'top');
    tooltip.register(dom.fpsCamera, 'Walk Mode', 'top');
    tooltip.register(dom.reset, 'Reset Camera', 'bottom');
    tooltip.register(dom.frame, 'Frame Scene', 'bottom');
    tooltip.register(dom.showVoxels, 'Show Voxels', 'top');
    tooltip.register(dom.settings, 'Settings', 'top');
    tooltip.register(dom.info, 'Help', 'top');
    tooltip.register(dom.prevTransformFrame, 'Previous Frame', 'top');
    tooltip.register(dom.nextTransformFrame, 'Next Frame', 'top');
    tooltip.register(dom.arMode, 'Enter AR', 'top');
    tooltip.register(dom.vrMode, 'Enter VR', 'top');
    tooltip.register(dom.enterFullscreen, 'Fullscreen', 'top');
    tooltip.register(dom.exitFullscreen, 'Fullscreen', 'top');

    const isThirdPartyEmbedded = () => {
        try {
            return window.location.hostname !== window.parent.location.hostname;
        } catch (e) {
            // cross-origin iframe — parent location is inaccessible
            return true;
        }
    };

    if (window.parent !== window && isThirdPartyEmbedded()) {
        const viewUrl = new URL(window.location.href);
        if (viewUrl.pathname === '/s') {
            viewUrl.pathname = '/view';
        }

        (dom.supersplatBranding as HTMLAnchorElement).href = viewUrl.toString();
        dom.supersplatBranding.classList.remove('hidden');
    }

    updateFlightMetadataTop();
    updateFlightMetadataTopLayout();
    window.addEventListener('resize', updateFlightMetadataTopLayout);
};

export { initPoster, initUI };
