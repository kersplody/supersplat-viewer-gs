import {
    BLEND_NORMAL,
    Color,
    CULLFACE_NONE,
    Entity,
    MeshInstance,
    StandardMaterial,
    createMesh,
    Vec3
} from 'playcanvas';
import type { Entity as EntityType, ScriptComponent } from 'playcanvas';

import { Annotation as AnnotationScript } from './annotation';
import type { Annotation as AnnotationSettings, MeasurementUnit, Rgba } from './settings';
import type { Global } from './types';

const DEFAULT_LINE_COLOR: Rgba = [1.0, 0.4, 0.0, 1.0];
const DEFAULT_BOX_COLOR: Rgba = [1.0, 0.4, 0.0, 0.15];

const tmpVecA = new Vec3();
const tmpVecB = new Vec3();
const tmpVecC = new Vec3();

type Segment = {
    start: Vec3;
    end: Vec3;
    entity: Entity;
};

type Decorator = {
    kind: 'box' | 'arrowheads';
    atStart: Entity;
    atEnd: Entity;
};

type MeasurementLabel = {
    dom: HTMLDivElement;
    start: Vec3;
    end: Vec3;
};

type BoxGeometry = {
    bottom: readonly Vec3[];
    top: readonly Vec3[];
    center: Vec3;
    scale: Vec3 | null;
    rotationTarget: Vec3 | null;
};

const formatLength = (value: number) => {
    return value >= 100 ? value.toFixed(1) : value.toFixed(2);
};

const units = {
    m: {
        toDisplay: (meters: number) => meters,
        suffix: 'm'
    },
    cm: {
        toDisplay: (meters: number) => meters * 100,
        suffix: 'cm'
    },
    ft: {
        toDisplay: (meters: number) => meters * 3.280839895,
        suffix: 'ft'
    },
    in: {
        toDisplay: (meters: number) => meters * 39.37007874,
        suffix: 'in'
    }
} as const;

const rgbaToCss = (rgba?: Rgba) => {
    if (!rgba) {
        return '';
    }

    const [r, g, b, a] = rgba;
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
};

const createColor = (rgba: Rgba) => {
    return new Color(rgba[0], rgba[1], rgba[2], rgba[3]);
};

const createPrimitiveMaterial = (rgba: Rgba) => {
    const color = createColor(rgba);
    const material = new StandardMaterial();
    material.diffuse.set(color.r, color.g, color.b);
    material.emissive.set(color.r, color.g, color.b);
    material.useLighting = false;
    material.opacity = color.a;
    if (color.a < 1) {
        material.blendType = BLEND_NORMAL;
        material.depthWrite = false;
    }
    material.update();
    return material;
};

const createFillMaterial = (rgba: Rgba) => {
    const color = createColor(rgba);
    const material = new StandardMaterial();
    material.diffuse.set(color.r, color.g, color.b);
    material.emissive.set(0, 0, 0);
    material.useLighting = true;
    material.twoSidedLighting = true;
    material.cull = CULLFACE_NONE;
    material.opacity = color.a;
    if (color.a < 1) {
        material.blendType = BLEND_NORMAL;
        material.depthWrite = false;
    }
    material.update();
    return material;
};

const appendQuad = (
    positions: number[],
    normals: number[],
    indices: number[],
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
    p3: Vec3
) => {
    const baseIndex = positions.length / 3;
    const edge0 = new Vec3().sub2(p1, p0);
    const edge1 = new Vec3().sub2(p2, p0);
    const normal = new Vec3().cross(edge0, edge1).normalize();
    [p0, p1, p2, p3].forEach((point) => {
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
    });
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
};

const createPrismFillEntity = (
    graphicsDevice: Global['app']['graphicsDevice'],
    box: BoxGeometry,
    material: StandardMaterial
) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    appendQuad(positions, normals, indices, box.bottom[0], box.bottom[3], box.bottom[2], box.bottom[1]);
    appendQuad(positions, normals, indices, box.top[0], box.top[1], box.top[2], box.top[3]);

    for (let i = 0; i < box.bottom.length; i++) {
        const next = (i + 1) % box.bottom.length;
        appendQuad(positions, normals, indices, box.bottom[i], box.bottom[next], box.top[next], box.top[i]);
    }

    const mesh = createMesh(graphicsDevice, positions, {
        normals,
        indices
    });

    const entity = new Entity('annotation-box-fill');
    const meshInstance = new MeshInstance(mesh, material);
    meshInstance.cull = false;
    entity.addComponent('render', {
        meshInstances: [meshInstance]
    });
    return entity;
};

const configureSegmentTransform = (entity: Entity, start: Vec3, end: Vec3, thickness: number) => {
    tmpVecA.sub2(end, start);
    const length = tmpVecA.length();
    if (length <= 1e-6) {
        entity.setLocalScale(0, 0, 0);
        return;
    }

    tmpVecB.add2(start, end).mulScalar(0.5);
    entity.setPosition(tmpVecB);
    entity.lookAt(end);
    entity.setLocalScale(thickness, thickness, length);
};

const configureBoxDecorator = (entity: Entity, point: Vec3, thickness: number) => {
    entity.setPosition(point);
    entity.setEulerAngles(0, 0, 0);
    entity.setLocalScale(thickness * 2.5, thickness * 2.5, thickness * 2.5);
};

const configureArrowDecorator = (entity: Entity, point: Vec3, direction: Vec3, thickness: number, forward: boolean) => {
    const headLength = thickness * 4;
    tmpVecA
        .copy(direction)
        .normalize()
        .mulScalar(forward ? 1 : -1);
    tmpVecB
        .copy(tmpVecA)
        .mulScalar(-headLength * 0.5)
        .add(point);
    entity.setPosition(tmpVecB);

    tmpVecC.add2(tmpVecB, tmpVecA);
    entity.lookAt(tmpVecC);
    entity.rotateLocal(90, 0, 0);
    entity.setLocalScale(thickness * 2.2, headLength, thickness * 2.2);
};

const buildAxisAlignedBox = (points: AnnotationSettings['points']): BoxGeometry => {
    const [a, b] = points!;
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    const minZ = Math.min(a[2], b[2]);
    const maxZ = Math.max(a[2], b[2]);

    const bottom = [
        new Vec3(minX, minY, minZ),
        new Vec3(maxX, minY, minZ),
        new Vec3(maxX, minY, maxZ),
        new Vec3(minX, minY, maxZ)
    ] as const;

    const top = [
        new Vec3(minX, maxY, minZ),
        new Vec3(maxX, maxY, minZ),
        new Vec3(maxX, maxY, maxZ),
        new Vec3(minX, maxY, maxZ)
    ] as const;

    return {
        bottom,
        top,
        center: new Vec3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
        scale: new Vec3(Math.max(1e-4, maxX - minX), Math.max(1e-4, maxY - minY), Math.max(1e-4, maxZ - minZ)),
        rotationTarget: null as Vec3 | null
    };
};

const buildThreePointBox = (points: [number[], number[], number[]]): BoxGeometry | null => {
    const [a, b, c] = points;
    const baseA = new Vec3(a[0], 0, a[2]);
    const baseB = new Vec3(b[0], 0, b[2]);
    const baseC = new Vec3(c[0], 0, c[2]);
    const yValues = [a[1], b[1], c[1]];
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const baseD = new Vec3(baseB.x + baseC.x - baseA.x, 0, baseB.z + baseC.z - baseA.z);

    tmpVecA.sub2(baseB, baseA);
    tmpVecB.sub2(baseC, baseA);
    const areaTwice = tmpVecA.x * tmpVecB.z - tmpVecA.z * tmpVecB.x;
    if (Math.abs(areaTwice) <= 1e-8) {
        return null;
    }

    const bottom = [
        new Vec3(baseA.x, minY, baseA.z),
        new Vec3(baseB.x, minY, baseB.z),
        new Vec3(baseD.x, minY, baseD.z),
        new Vec3(baseC.x, minY, baseC.z)
    ];
    const top = [
        new Vec3(baseA.x, maxY, baseA.z),
        new Vec3(baseB.x, maxY, baseB.z),
        new Vec3(baseD.x, maxY, baseD.z),
        new Vec3(baseC.x, maxY, baseC.z)
    ];

    const center = new Vec3().add2(bottom[0], bottom[2]).mulScalar(0.5);
    center.y = (minY + maxY) * 0.5;

    return {
        bottom,
        top,
        center,
        scale: null,
        rotationTarget: null
    };
};

class AnnotationGeometry {
    root: Entity;

    materials: StandardMaterial[] = [];

    segments: Segment[] = [];

    decorator: Decorator | null = null;

    anchor: Vec3;

    lineThickness: number;

    measurementLabels: MeasurementLabel[] = [];

    showMeasurement: boolean;

    measurementUnit: MeasurementUnit;

    measureScale: number;

    graphicsDevice: Global['app']['graphicsDevice'];

    constructor(global: Global, annotation: AnnotationSettings) {
        this.root = new Entity('annotation-geometry');
        this.anchor = new Vec3(annotation.position[0], annotation.position[1], annotation.position[2]);
        this.lineThickness = Math.max(1, annotation.lineThickness ?? 2);
        this.showMeasurement = annotation.showMeasurement === true;
        this.measurementUnit = annotation.measurementUnits ?? 'm';
        this.measureScale =
            Number.isFinite(global.settings.scene_meas_scale) && global.settings.scene_meas_scale > 0
                ? global.settings.scene_meas_scale
                : 1;
        this.graphicsDevice = global.app.graphicsDevice;

        const lineColor = annotation.lineColor ?? DEFAULT_LINE_COLOR;
        const edgeMaterial = createPrimitiveMaterial(lineColor);
        this.materials.push(edgeMaterial);

        global.app.root.addChild(this.root);

        if (annotation.kind === 'line') {
            this.buildLine(annotation, edgeMaterial);
        } else if (annotation.kind === 'box') {
            this.buildBox(annotation, edgeMaterial);
        }

        if (this.showMeasurement) {
            this.measurementLabels.forEach((label) => {
                AnnotationScript.parentDom?.appendChild(label.dom);
            });
        }
    }

    private createSegment(start: Vec3, end: Vec3, material: StandardMaterial) {
        const entity = new Entity('annotation-segment');
        entity.addComponent('render', {
            type: 'box',
            material
        });
        this.root.addChild(entity);
        this.segments.push({
            start: start.clone(),
            end: end.clone(),
            entity
        });
    }

    private createMeasurementLabel(start: Vec3, end: Vec3) {
        const dom = document.createElement('div');
        dom.className = 'pc-annotation-measure';
        this.measurementLabels.push({
            dom,
            start: start.clone(),
            end: end.clone()
        });
    }

    private buildLine(annotation: AnnotationSettings, material: StandardMaterial) {
        const [start, end] = annotation.points!;
        const startVec = new Vec3(start[0], start[1], start[2]);
        const endVec = new Vec3(end[0], end[1], end[2]);
        this.createSegment(startVec, endVec, material);
        if (this.showMeasurement) {
            this.createMeasurementLabel(startVec, endVec);
        }

        const decorator = annotation.lineDecorator ?? 'none';
        if (decorator === 'none') {
            return;
        }

        const decoratorType = decorator === 'arrowheads' ? 'cone' : 'box';
        const atStart = new Entity('annotation-decorator-start');
        atStart.addComponent('render', {
            type: decoratorType,
            material
        });
        this.root.addChild(atStart);

        const atEnd = new Entity('annotation-decorator-end');
        atEnd.addComponent('render', {
            type: decoratorType,
            material
        });
        this.root.addChild(atEnd);

        this.decorator = {
            kind: decorator,
            atStart,
            atEnd
        };
    }

    private buildBox(annotation: AnnotationSettings, material: StandardMaterial) {
        const points = annotation.points!;
        const box =
            points.length === 3
                ? (buildThreePointBox(points as [number[], number[], number[]]) ?? buildAxisAlignedBox(points))
                : buildAxisAlignedBox(points);

        const count = box.bottom.length;
        for (let i = 0; i < count; i++) {
            const next = (i + 1) % count;
            this.createSegment(box.bottom[i], box.bottom[next], material);
            this.createSegment(box.top[i], box.top[next], material);
            this.createSegment(box.bottom[i], box.top[i], material);
        }

        if (this.showMeasurement && count >= 2) {
            this.createMeasurementLabel(box.bottom[0], box.bottom[1]);
            this.createMeasurementLabel(box.bottom[0], box.bottom[count - 1]);
            this.createMeasurementLabel(box.bottom[0], box.top[0]);
        }

        {
            const fillMaterial = createFillMaterial(annotation.boxColor ?? DEFAULT_BOX_COLOR);
            this.materials.push(fillMaterial);
            const fill = box.scale
                ? new Entity('annotation-box-fill')
                : createPrismFillEntity(this.graphicsDevice, box, fillMaterial);

            if (box.scale) {
                fill.addComponent('render', {
                    type: 'box',
                    material: fillMaterial
                });
                fill.setPosition(box.center);
                if (box.rotationTarget) {
                    fill.lookAt(box.rotationTarget);
                }
                fill.setLocalScale(box.scale);
            }
            this.root.addChild(fill);
        }
    }

    private computeThicknessWorld(cameraEntity: Entity) {
        const camera = cameraEntity.camera;
        const viewMatrix = camera.viewMatrix;
        viewMatrix.transformPoint(this.anchor, tmpVecA);
        const depth = Math.max(0.1, -tmpVecA.z);
        const { width, height } = camera.system.app.graphicsDevice.clientRect;
        const fovRad = (camera.fov * Math.PI) / 180;
        const worldSpan = 2 * depth * Math.tan(fovRad * 0.5);
        const worldPerPixel = camera.horizontalFov ? worldSpan / width : worldSpan / height;
        return Math.max(0.001, this.lineThickness * worldPerPixel);
    }

    update(cameraEntity: Entity) {
        if (!this.root.enabled) {
            return;
        }

        const thickness = this.computeThicknessWorld(cameraEntity);
        this.segments.forEach((segment) => {
            configureSegmentTransform(segment.entity, segment.start, segment.end, thickness);
        });

        if (this.decorator) {
            const line = this.segments[0];
            if (!line) return;

            tmpVecA.sub2(line.end, line.start);
            if (this.decorator.kind === 'box') {
                configureBoxDecorator(this.decorator.atStart, line.start, thickness);
                configureBoxDecorator(this.decorator.atEnd, line.end, thickness);
            } else {
                configureArrowDecorator(this.decorator.atStart, line.start, tmpVecA, thickness, false);
                configureArrowDecorator(this.decorator.atEnd, line.end, tmpVecA, thickness, true);
            }
        }

        if (this.showMeasurement) {
            this.updateMeasurementLabels(cameraEntity);
        }
    }

    private updateMeasurementLabels(cameraEntity: EntityType) {
        const camera = cameraEntity.camera;
        const viewMatrix = camera.viewMatrix;
        const unit = units[this.measurementUnit];

        this.measurementLabels.forEach((label) => {
            tmpVecA.add2(label.start, label.end).mulScalar(0.5);
            viewMatrix.transformPoint(tmpVecA, tmpVecB);
            if (tmpVecB.z >= 0) {
                label.dom.style.display = 'none';
                return;
            }

            const screen = camera.worldToScreen(tmpVecA, tmpVecC);
            const meters = label.start.distance(label.end) * this.measureScale;
            label.dom.textContent = `${formatLength(unit.toDisplay(meters))} ${unit.suffix}`;
            label.dom.style.left = `${screen.x}px`;
            label.dom.style.top = `${screen.y}px`;
            label.dom.style.display = 'block';
        });
    }

    setVisible(visible: boolean) {
        this.root.enabled = visible;
        this.measurementLabels.forEach((label) => {
            label.dom.style.display = visible && this.showMeasurement ? label.dom.style.display : 'none';
        });
    }

    destroy() {
        this.root.destroy();
        this.measurementLabels.forEach((label) => label.dom.remove());
        this.materials.forEach((material) => material.destroy());
        this.materials = [];
    }
}

class Annotations {
    annotations: AnnotationSettings[];

    parentDom: HTMLElement;

    geometry: AnnotationGeometry[] = [];

    constructor(global: Global, hasCameraFrame: boolean) {
        const parentDom = document.createElement('div');
        parentDom.id = 'annotations';
        AnnotationScript.parentDom = parentDom;
        document.querySelector('#ui').appendChild(parentDom);

        this.annotations = global.settings.annotations;
        this.parentDom = parentDom;

        const { state } = global;
        let annotationsVisible = true;

        const updateVisibility = () => {
            const firstPersonGamingControls =
                (state.cameraMode === 'walk' || state.cameraMode === 'fly') && state.gamingControls;
            annotationsVisible = state.showAnnotations && !state.controlsHidden && !firstPersonGamingControls;

            parentDom.style.display = annotationsVisible ? 'block' : 'none';
            AnnotationScript.opacity = annotationsVisible ? 1.0 : 0.0;
            this.geometry.forEach((item) => item.setVisible(annotationsVisible));
            if (this.annotations.length > 0) {
                if (!annotationsVisible) {
                    AnnotationScript.activeAnnotation?.hideTooltip();
                }
                global.app.renderNextFrame = true;
            }
        };

        global.events.on('controlsHidden:changed', updateVisibility);
        global.events.on('showAnnotations:changed', updateVisibility);
        global.events.on('cameraMode:changed', updateVisibility);
        global.events.on('gamingControls:changed', updateVisibility);

        if (hasCameraFrame) {
            AnnotationScript.hotspotColor.gamma();
            AnnotationScript.hoverColor.gamma();
        }

        const parent = global.app.root;
        const scriptMap = new Map<AnnotationSettings, AnnotationScript>();

        for (let i = 0; i < this.annotations.length; i++) {
            const ann = this.annotations[i];

            const entity = new Entity();
            entity.addComponent('script');
            entity.script.create(AnnotationScript);
            const script = entity.script as ScriptComponent & { annotation: AnnotationScript };
            script.annotation.label = (i + 1).toString();
            script.annotation.title = ann.title;
            script.annotation.text = ann.text;
            script.annotation.textColor = rgbaToCss(ann.textColor);
            script.annotation.msgBoxColor = rgbaToCss(ann.msgBoxColor);

            entity.setPosition(ann.position[0], ann.position[1], ann.position[2]);

            parent.addChild(entity);

            const kind = ann.kind ?? 'point';
            if (kind === 'line' || kind === 'box') {
                this.geometry.push(new AnnotationGeometry(global, ann));
            }

            scriptMap.set(ann, script.annotation);

            script.annotation.on('show', () => {
                global.events.fire('annotation.activate', ann);
            });

            script.annotation.on('hide', () => {
                global.events.fire('annotation.deactivate');
            });

            script.annotation.on('hover', (_hover: boolean) => {
                global.app.renderNextFrame = true;
            });
        }

        global.events.on('annotation.navigate', (ann: AnnotationSettings) => {
            const script = scriptMap.get(ann);
            if (script) {
                script.showTooltip();
            }
        });

        global.app.on('prerender', () => {
            if (!annotationsVisible) {
                return;
            }
            this.geometry.forEach((item) => item.update(global.camera));
        });

        updateVisibility();
    }
}

export { Annotations };
