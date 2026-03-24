import {
    BLEND_NORMAL,
    Color,
    Entity,
    type Entity as EntityType,
    StandardMaterial,
    Vec3
} from 'playcanvas';

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
    tmpVecA.copy(direction).normalize().mulScalar(forward ? 1 : -1);
    tmpVecB.copy(tmpVecA).mulScalar(-headLength * 0.5).add(point);
    entity.setPosition(tmpVecB);

    tmpVecC.add2(tmpVecB, tmpVecA);
    entity.lookAt(tmpVecC);
    entity.rotateLocal(90, 0, 0);
    entity.setLocalScale(thickness * 2.2, headLength, thickness * 2.2);
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

    constructor(global: Global, annotation: AnnotationSettings) {
        this.root = new Entity('annotation-geometry');
        this.anchor = new Vec3(annotation.position[0], annotation.position[1], annotation.position[2]);
        this.lineThickness = Math.max(1, annotation.lineThickness ?? 2);
        this.showMeasurement = annotation.showMeasurement === true;
        this.measurementUnit = annotation.measurementUnits ?? 'm';
        this.measureScale = Number.isFinite(global.settings.scene_meas_scale) && global.settings.scene_meas_scale > 0 ?
            global.settings.scene_meas_scale :
            1;

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

        let minX: number;
        let maxX: number;
        let minY: number;
        let maxY: number;
        let minZ: number;
        let maxZ: number;

        if (points.length === 3) {
            const [a, b, c] = points;
            minX = Math.min(a[0], b[0], c[0]);
            maxX = Math.max(a[0], b[0], c[0]);
            minZ = Math.min(a[2], b[2], c[2]);
            maxZ = Math.max(a[2], b[2], c[2]);
            minY = Math.min(a[1], b[1], c[1]);
            maxY = Math.max(a[1], b[1], c[1]);
        } else {
            const [a, b] = points;
            minX = Math.min(a[0], b[0]);
            maxX = Math.max(a[0], b[0]);
            minZ = Math.min(a[2], b[2]);
            maxZ = Math.max(a[2], b[2]);
            minY = Math.min(a[1], b[1]);
            maxY = Math.max(a[1], b[1]);
        }

        const corners = [
            new Vec3(minX, minY, minZ),
            new Vec3(maxX, minY, minZ),
            new Vec3(maxX, minY, maxZ),
            new Vec3(minX, minY, maxZ),
            new Vec3(minX, maxY, minZ),
            new Vec3(maxX, maxY, minZ),
            new Vec3(maxX, maxY, maxZ),
            new Vec3(minX, maxY, maxZ)
        ];

        const edges: [number, number][] = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7]
        ];

        edges.forEach(([i0, i1]) => {
            this.createSegment(corners[i0], corners[i1], material);
        });

        if (this.showMeasurement) {
            this.createMeasurementLabel(corners[0], corners[1]);
            this.createMeasurementLabel(corners[0], corners[3]);
            this.createMeasurementLabel(corners[0], corners[4]);
        }

        const fillMaterial = createPrimitiveMaterial(annotation.boxColor ?? DEFAULT_BOX_COLOR);
        this.materials.push(fillMaterial);
        const fill = new Entity('annotation-box-fill');
        fill.addComponent('render', {
            type: 'box',
            material: fillMaterial
        });
        tmpVecA.set(
            (minX + maxX) * 0.5,
            (minY + maxY) * 0.5,
            (minZ + maxZ) * 0.5
        );
        fill.setPosition(tmpVecA);
        fill.setLocalScale(
            Math.max(1e-4, maxX - minX),
            Math.max(1e-4, maxY - minY),
            Math.max(1e-4, maxZ - minZ)
        );
        this.root.addChild(fill);
    }

    private computeThicknessWorld(cameraEntity: Entity) {
        const camera = cameraEntity.camera;
        const viewMatrix = camera.viewMatrix;
        viewMatrix.transformPoint(this.anchor, tmpVecA);
        const depth = Math.max(0.1, -tmpVecA.z);
        const { width, height } = camera.system.app.graphicsDevice.clientRect;
        const fovRad = camera.fov * Math.PI / 180;
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
        this.measurementLabels.forEach(label => {
            label.dom.style.display = visible && this.showMeasurement ? label.dom.style.display : 'none';
        });
    }

    destroy() {
        this.root.destroy();
        this.measurementLabels.forEach(label => label.dom.remove());
        this.materials.forEach(material => material.destroy());
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

        const updateVisibility = () => {
            const visible = global.state.annotationsVisible;
            parentDom.style.display = visible ? 'block' : 'none';
            AnnotationScript.opacity = visible ? 1.0 : 0.0;
            this.geometry.forEach(item => item.setVisible(visible));
            if (this.annotations.length > 0) {
                if (!global.state.annotationsVisible) {
                    AnnotationScript.activeAnnotation?.hideTooltip();
                }
                global.app.renderNextFrame = true;
            }
        };

        global.events.on('controlsHidden:changed', updateVisibility);
        global.events.on('annotationsVisible:changed', updateVisibility);

        this.annotations = global.settings.annotations;
        this.parentDom = parentDom;

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
            const script = entity.script as any;
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

            script.annotation.on('hover', () => {
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
            if (!global.state.annotationsVisible) {
                return;
            }
            this.geometry.forEach(item => item.update(global.camera));
        });

        updateVisibility();
    }
}

export { Annotations };
