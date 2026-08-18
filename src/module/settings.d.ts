export type Vec3 = [number, number, number];
export type Rgba = [number, number, number, number];
export type LineDecorator = 'none' | 'box' | 'arrowheads';
export type MeasurementUnit = 'm' | 'ft' | 'in' | 'cm';

export type AnimTrack = {
    name: string;
    duration: number;
    frameRate: number;
    loopMode: 'none' | 'repeat' | 'pingpong';
    interpolation: 'step' | 'spline';
    smoothness: number;
    keyframes: {
        times: number[];
        values: {
            position: number[];
            target: number[];
            fov: number[];
        };
    };
};

export type CameraPose = {
    position: Vec3;
    target: Vec3;
    fov: number;
};

export type Camera = {
    initial: CameraPose;
};

export type Annotation = {
    position: Vec3;
    title: string;
    text: string;
    textColor?: Rgba;
    msgBoxColor?: Rgba;
    extras?: unknown;
    camera: Camera;
    kind?: 'point' | 'line' | 'box';
    points?: [Vec3] | [Vec3, Vec3] | [Vec3, Vec3, Vec3];
    lineColor?: Rgba;
    lineDecorator?: LineDecorator;
    lineThickness?: number;
    boxColor?: Rgba;
    showMeasurement?: boolean;
    measurementUnits?: MeasurementUnit;
};

export type PostEffectSettings = {
    sharpness: {
        enabled: boolean;
        amount: number;
    };
    bloom: {
        enabled: boolean;
        intensity: number;
        blurLevel: number;
    };
    grading: {
        enabled: boolean;
        brightness: number;
        contrast: number;
        saturation: number;
        tint: [number, number, number];
    };
    vignette: {
        enabled: boolean;
        intensity: number;
        inner: number;
        outer: number;
        curvature: number;
    };
    fringing: {
        enabled: boolean;
        intensity: number;
    };
};

export type ExperienceSettings = {
    version: 2;
    tonemapping: 'none' | 'linear' | 'filmic' | 'hejl' | 'aces' | 'aces2' | 'neutral';
    highPrecisionRendering: boolean;
    soundUrl?: string;
    scene_meas_scale?: number;
    hasFramePreviews?: boolean;
    sceneRotation?: {
        x: number;
        y: number;
        z: number;
    };
    background: {
        color: [number, number, number];
        skyboxUrl?: string;
    };
    postEffectSettings: PostEffectSettings;
    animTracks: AnimTrack[];
    cameras: Camera[];
    annotations: Annotation[];
    startMode: 'default' | 'animTrack' | 'annotation';
};

export function importSettings(settings: unknown): ExperienceSettings;
export function validateSettings(settings: unknown): void;
