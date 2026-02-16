/* eslint-disable no-unused-vars */
interface Window {
    sse: {
        config: object,
        settings: Promise<object>,
        geoXform: Promise<object>,
        transforms: Promise<object>
    }

    firstFrame?: () => void;
}

declare module 'playcanvas/scripts/esm/xr-controllers.mjs' {
    const XrControllers: any;
    export { XrControllers };
}

declare module 'playcanvas/scripts/esm/xr-navigation.mjs' {
    const XrNavigation: any;
    export { XrNavigation };
}

declare module '*.html' {
    const content: string;
    export default content;
}

declare module '*.css' {
    const content: string;
    export default content;
}

declare module '*.js' {
    const content: string;
    export default content;
}
