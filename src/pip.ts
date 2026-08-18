import type { Global } from './types';

type JsonRecord = Record<string, unknown>;

type FrameSelection = {
    filePath?: string | null;
    colmapImId?: number | null;
};

const asRecord = (value: unknown): JsonRecord | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;

const normalizeImdatCommon = (value: unknown) => {
    const imdat = asRecord(value);
    if (!imdat) return null;

    const header = asRecord(imdat.header);
    const legacy = asRecord(header?.common);
    if (legacy) return legacy;

    const common: JsonRecord = {};
    const mappings: [string, string[]][] = [
        ['dc:identifier', ['flightId', 'flight_id']],
        ['geoswarm:missionId', ['missionId', 'mission_id']],
        ['geoswarm:customer', ['customer']],
        ['geoswarm:control', ['control']],
        ['geoswarm:DateTimeCaptureStart', ['dateTimeCaptureStart', 'date_time_capture_start']],
        ['geoswarm:DateTimeCaptureEnd', ['dateTimeCaptureEnd', 'date_time_capture_end']],
        ['geoswarm:ellipsoid', ['ellipsoid']],
        ['geoswarm:crs', ['crs']]
    ];
    for (const [target, sources] of mappings) {
        const source = sources.find((key) => imdat[key] !== undefined && imdat[key] !== null && imdat[key] !== '');
        if (source) common[target] = imdat[source];
    }
    return Object.keys(common).length ? common : null;
};

const normalizeImdatPhotos = (value: unknown) => {
    const imdat = asRecord(value);
    return asRecord(imdat?.photos) ?? asRecord(imdat?.images);
};

const getTransformFrameCount = (value: unknown) => {
    const transforms = asRecord(value);
    return Array.isArray(transforms?.frames) ? transforms.frames.length : 0;
};

const initPip = (global: Global, dom: Record<string, HTMLElement>) => {
    const { events, state } = global;
    const thumb = dom.pipFrameThumb as HTMLImageElement;
    const full = dom.pipFrameFull as HTMLImageElement;
    const fullscreen = dom.pipFrameFullscreen;
    const previous = dom.pipPrevTransformFrame as HTMLButtonElement;
    const next = dom.pipNextTransformFrame as HTMLButtonElement;
    const metadataToggle = dom.pipMetadataToggle as HTMLButtonElement;
    const metadataPanel = dom.pipMetadataPanel;
    const flightMetadata = dom.flightMetadataTop;
    const commonMetadata = normalizeImdatCommon(global.imdat);
    const photoMetadata = normalizeImdatPhotos(global.imdat);
    const imdat = asRecord(global.imdat);
    const imdatSources = Array.isArray(imdat?.sources)
        ? imdat.sources.map(asRecord).filter((item) => item !== null)
        : [];
    const hasFramePreviews = global.settings.hasFramePreviews === true;
    const hasTransformFrames = getTransformFrameCount(global.transforms) > 0;

    let selection: FrameSelection | null = null;
    let fullscreenOpen = false;
    let metadataOpen = false;
    let metadataText = '';
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let draggingPointer: number | null = null;
    let dragX = 0;
    let dragY = 0;
    let dragPanX = 0;
    let dragPanY = 0;
    let dragged = false;
    let suppressCloseClick = false;
    const touches = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    let pinchZoom = 1;
    let pinchPanX = 0;
    let pinchPanY = 0;
    let pinchMidX = 0;
    let pinchMidY = 0;

    const derivePath = (filePath: string, directory: 'images_jpg_8' | 'images_jpg') =>
        filePath.replace(/(^|\/)images\//i, `$1${directory}/`).replace(/\.[^./\\]+$/, '.jpg');

    const animationRunning = () => state.cameraMode === 'anim' && !state.animationPaused;
    const renderValue = (value: unknown) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
        if (typeof value === 'boolean') return String(value);
        try {
            return JSON.stringify(value);
        } catch (_error) {
            return '';
        }
    };

    const updateFlightMetadata = () => {
        if (!commonMetadata) {
            flightMetadata.classList.add('hidden');
            return;
        }
        const flightId = renderValue(commonMetadata['dc:identifier']);
        const missionId = renderValue(commonMetadata['geoswarm:missionId']);
        const customer = renderValue(commonMetadata['geoswarm:customer']);
        const control = renderValue(commonMetadata['geoswarm:control']);
        const source = imdatSources[state.activeSplat - 1];
        const sourceCapture =
            source?.date_time_capture_start ??
            source?.dateTimeCaptureStart ??
            source?.['geoswarm:DateTimeCaptureStart'];
        const capture = renderValue(sourceCapture ?? commonMetadata['geoswarm:DateTimeCaptureStart']).replace(
            /^(\d{4}):(\d{2}):(\d{2})\s/,
            '$1-$2-$3 '
        );
        const lines = [
            [flightId && `FlightId: ${flightId}`, missionId && `MissionID: ${missionId}`].filter(Boolean).join('  |  '),
            [customer && `Customer: ${customer}`, control && `Control: ${control}`, capture && `Flight: ${capture}`]
                .filter(Boolean)
                .join('  |  ')
        ].filter(Boolean);
        flightMetadata.textContent = lines.join('\n');
        flightMetadata.classList.toggle('hidden', lines.length === 0 || fullscreenOpen);
    };

    const updateTopLayout = () => {
        const edgePadding = 16;
        const gap = 12;
        let left = edgePadding;
        const right = window.innerWidth - edgePadding;

        if (!dom.pipFrameWrap.classList.contains('hidden')) {
            left = Math.max(left, dom.pipFrameWrap.getBoundingClientRect().right + gap);
        }

        // Keep a usable banner width on very narrow screens. The PiP is only a
        // third of the viewport there, so this normally still clears it.
        if (right - left < 120) left = edgePadding;

        flightMetadata.style.left = `${left}px`;
        flightMetadata.style.right = `${Math.max(edgePadding, window.innerWidth - right)}px`;

        if (state.inputMode === 'desktop') {
            const metadataVisible =
                !flightMetadata.classList.contains('hidden') && !!flightMetadata.textContent?.trim();
            const top = metadataVisible ? Math.ceil(flightMetadata.getBoundingClientRect().bottom + gap) : edgePadding;
            dom.annotationNav.style.top = `${top}px`;
        } else {
            dom.annotationNav.style.removeProperty('top');
        }
    };

    const findPhotoMetadata = (current: FrameSelection | null) => {
        if (!photoMetadata || !current?.filePath) return null;
        const filePath = current.filePath;
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
            current.colmapImId === undefined || current.colmapImId === null ? '' : String(current.colmapImId)
        ];
        for (const key of candidates) {
            const found = asRecord(photoMetadata[key]);
            if (found) return found;
        }
        return null;
    };

    const updateMetadataControls = () => {
        const showMetadata = fullscreenOpen && metadataText.length > 0;
        metadataToggle.classList.toggle('hidden', !showMetadata);
        previous.classList.toggle('hidden', !fullscreenOpen || !hasTransformFrames || !selection?.filePath);
        next.classList.toggle('hidden', !fullscreenOpen || !hasTransformFrames || !selection?.filePath);
        metadataPanel.classList.toggle('hidden', !showMetadata || !metadataOpen);
        metadataPanel.textContent = showMetadata && metadataOpen ? metadataText : '';
    };

    const updateMetadata = () => {
        const toLines = (title: string, record: JsonRecord | null) => {
            const lines = Object.entries(record ?? {})
                .filter(([key]) => !/(^|:)srtTags$/i.test(key))
                .map(([key, value]) => {
                    const rendered = renderValue(value);
                    return rendered ? `${key}: ${rendered}` : '';
                })
                .filter(Boolean);
            return lines.length ? [title, ...lines].join('\n') : '';
        };
        metadataText = [toLines('Common', commonMetadata), toLines('Photo', findPhotoMetadata(selection))]
            .filter(Boolean)
            .join('\n\n');
        if (!metadataText) metadataOpen = false;
        updateMetadataControls();
    };

    const inspectState = () => {
        const rect = full.getBoundingClientRect();
        const sourceWidth = full.naturalWidth;
        const sourceHeight = full.naturalHeight;
        if (!(rect.width > 0 && rect.height > 0 && sourceWidth > 0 && sourceHeight > 0)) return null;
        const imageWidth = rect.width / zoom;
        const imageHeight = rect.height / zoom;
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        return {
            zoom,
            panX,
            panY,
            imageWidth,
            imageHeight,
            sourceWidth,
            sourceHeight,
            centerU: sourceWidth * 0.5 + (window.innerWidth * 0.5 - centerX) / ((imageWidth / sourceWidth) * zoom),
            centerV: sourceHeight * 0.5 + (window.innerHeight * 0.5 - centerY) / ((imageHeight / sourceHeight) * zoom)
        };
    };

    const emitInspect = () => {
        const details = fullscreenOpen ? inspectState() : null;
        events.fire('pipInspect:changed', details ? { active: true, ...details } : { active: false });
        global.app.renderNextFrame = true;
    };

    const applyTransform = () => {
        full.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        emitInspect();
    };

    const resetPointers = () => {
        draggingPointer = null;
        dragged = false;
        suppressCloseClick = false;
        touches.clear();
        pinchDistance = 0;
    };

    const close = () => {
        if (!fullscreenOpen) return;
        fullscreenOpen = false;
        fullscreen.classList.add('hidden');
        full.removeAttribute('src');
        metadataOpen = false;
        resetPointers();
        updateFlightMetadata();
        updateTopLayout();
        updateMetadataControls();
        emitInspect();
    };

    const open = () => {
        if (!selection?.filePath) return;
        fullscreenOpen = true;
        fullscreen.classList.remove('hidden');
        full.src = derivePath(selection.filePath, 'images_jpg');
        metadataOpen = false;
        updateFlightMetadata();
        updateTopLayout();
        updateMetadataControls();
        applyTransform();
    };

    const updateVisibility = () => {
        const visible = hasFramePreviews && !!selection?.filePath && !animationRunning();
        dom.pipFrameWrap.classList.toggle('hidden', !visible);
        events.fire('pipVisibility:changed', visible);
        updateTopLayout();
        if (!visible) close();
    };

    const zoomAt = (clientX: number, clientY: number, nextZoom: number) => {
        const clamped = Math.min(8, Math.max(1, nextZoom));
        if (clamped === zoom) return;
        const rect = full.getBoundingClientRect();
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        const offsetX = clientX - centerX;
        const offsetY = clientY - centerY;
        panX = offsetX - ((offsetX - panX) / zoom) * clamped;
        panY = offsetY - ((offsetY - panY) / zoom) * clamped;
        zoom = clamped;
        applyTransform();
    };

    const isControl = (target: EventTarget | null) => {
        const node = target as Node | null;
        return (
            !!node &&
            (metadataToggle.contains(node) ||
                previous.contains(node) ||
                next.contains(node) ||
                metadataPanel.contains(node))
        );
    };

    dom.pipFrameWrap.addEventListener('click', (event) => {
        event.stopPropagation();
        events.fire('inputEvent', 'gotoCurrentTransformFrame', event);
        open();
    });

    window.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
        if (event.key === 'z' || event.key === 'Z') {
            if (fullscreenOpen) close();
            else if (!dom.pipFrameWrap.classList.contains('hidden')) {
                events.fire('inputEvent', 'gotoCurrentTransformFrame', event);
                open();
            }
            event.preventDefault();
        }
    });

    events.on('inputEvent', (name: string) => {
        if (name === 'cancel') close();
    });

    full.addEventListener('load', emitInspect);
    fullscreen.addEventListener(
        'wheel',
        (event: WheelEvent) => {
            if (!fullscreenOpen) return;
            event.preventDefault();
            event.stopPropagation();
            zoomAt(event.clientX, event.clientY, zoom * Math.exp(-event.deltaY * 0.0015));
        },
        { passive: false }
    );

    fullscreen.addEventListener('pointerdown', (event: PointerEvent) => {
        if (!fullscreenOpen || isControl(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.pointerType === 'touch') {
            touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (touches.size === 2) {
                const [a, b] = [...touches.values()];
                pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
                pinchZoom = zoom;
                pinchPanX = panX;
                pinchPanY = panY;
                pinchMidX = (a.x + b.x) * 0.5;
                pinchMidY = (a.y + b.y) * 0.5;
            }
        } else if (event.button === 0) {
            draggingPointer = event.pointerId;
            dragX = event.clientX;
            dragY = event.clientY;
            dragPanX = panX;
            dragPanY = panY;
            dragged = false;
            fullscreen.setPointerCapture(event.pointerId);
        }
    });

    fullscreen.addEventListener('pointermove', (event: PointerEvent) => {
        if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
            touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (touches.size === 2 && pinchDistance > 0) {
                const [a, b] = [...touches.values()];
                const currentDistance = Math.hypot(a.x - b.x, a.y - b.y);
                const midX = (a.x + b.x) * 0.5;
                const midY = (a.y + b.y) * 0.5;
                panX = pinchPanX + midX - pinchMidX;
                panY = pinchPanY + midY - pinchMidY;
                zoomAt(midX, midY, pinchZoom * (currentDistance / pinchDistance));
                suppressCloseClick = true;
            }
            return;
        }
        if (event.pointerId !== draggingPointer) return;
        const dx = event.clientX - dragX;
        const dy = event.clientY - dragY;
        dragged ||= Math.abs(dx) > 2 || Math.abs(dy) > 2;
        panX = dragPanX + dx;
        panY = dragPanY + dy;
        applyTransform();
    });

    const releasePointer = (event: PointerEvent) => {
        if (event.pointerType === 'touch') {
            touches.delete(event.pointerId);
            if (touches.size < 2) pinchDistance = 0;
            return;
        }
        if (event.pointerId !== draggingPointer) return;
        draggingPointer = null;
        suppressCloseClick = dragged;
        if (fullscreen.hasPointerCapture(event.pointerId)) fullscreen.releasePointerCapture(event.pointerId);
    };
    fullscreen.addEventListener('pointerup', releasePointer);
    fullscreen.addEventListener('pointercancel', releasePointer);
    fullscreen.addEventListener('click', (event) => {
        event.stopPropagation();
        if (isControl(event.target)) return;
        if (suppressCloseClick) {
            suppressCloseClick = false;
            return;
        }
        close();
    });

    const stopControlEvent = (event: Event) => event.stopPropagation();
    for (const element of [metadataToggle, metadataPanel, previous, next]) {
        element.addEventListener('pointerdown', stopControlEvent);
        element.addEventListener('click', stopControlEvent);
    }
    metadataPanel.addEventListener('wheel', stopControlEvent, { passive: true });
    metadataToggle.addEventListener('click', () => {
        metadataOpen = !metadataOpen;
        updateMetadataControls();
    });
    previous.addEventListener('click', (event) => events.fire('inputEvent', 'prevTransformFrame', event));
    next.addEventListener('click', (event) => events.fire('inputEvent', 'nextTransformFrame', event));

    events.on('transformFrame:selected', (value: FrameSelection | null | undefined) => {
        selection = value?.filePath ? value : null;
        if (selection?.filePath && hasFramePreviews) {
            thumb.src = derivePath(selection.filePath, 'images_jpg_8');
            if (fullscreenOpen) full.src = derivePath(selection.filePath, 'images_jpg');
        } else {
            thumb.removeAttribute('src');
            full.removeAttribute('src');
        }
        updateMetadata();
        updateVisibility();
    });
    events.on('cameraMode:changed', updateVisibility);
    events.on('animationPaused:changed', updateVisibility);
    events.on('activeSplat:changed', () => {
        updateFlightMetadata();
        updateTopLayout();
    });
    events.on('inputMode:changed', updateTopLayout);
    events.on('transformFrame:nearestUpdated', () => {
        if (!fullscreenOpen) {
            zoom = 1;
            panX = 0;
            panY = 0;
            full.style.transform = '';
        }
    });
    window.addEventListener('resize', () => {
        emitInspect();
        updateTopLayout();
    });

    updateFlightMetadata();
    updateTopLayout();
    updateMetadataControls();
    return hasFramePreviews;
};

export { initPip };
