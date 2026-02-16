import { Script, type Vec3, type Quat } from 'playcanvas';

type ControllerEntry = {
    entity: any;
    jointMap: Map<any, any>;
};

const getInputPosition = (inputSource: any): Vec3 | null => {
    if (!inputSource) {
        return null;
    }
    try {
        if (inputSource.grip && typeof inputSource.getPosition === 'function') {
            const pos = inputSource.getPosition();
            if (pos) {
                return pos;
            }
        }
    } catch {
        // ignore; grip pose may be unavailable
    }
    try {
        if (typeof inputSource.getOrigin === 'function') {
            const origin = inputSource.getOrigin();
            if (origin) {
                return origin;
            }
        }
    } catch {
        // ignore; origin may be unavailable
    }
    return null;
};

const getInputRotation = (inputSource: any): Quat | null => {
    if (!inputSource) {
        return null;
    }
    try {
        if (typeof inputSource.getRotation === 'function') {
            const rot = inputSource.getRotation();
            if (rot) {
                return rot;
            }
        }
    } catch {
        // ignore; rotation may be unavailable
    }
    return null;
};

class XrControllers extends Script {
    static scriptName = 'xrControllers';

    /**
     * The base URL for fetching the WebXR input profiles.
     *
     * @attribute
     * @type {string}
     */
    basePath = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets/dist/profiles';

    controllers = new Map<any, ControllerEntry>();

    initialize() {
        if (!this.app.xr) {
            console.error('XrControllers script requires XR to be enabled on the application');
            return;
        }

        this.app.xr.input.on('add', async (inputSource) => {
            try {
                if (inputSource.hand) {
                    // Avoid duplicating system-rendered hands.
                    return;
                }
                if (!inputSource.profiles?.length) {
                    console.warn('No profiles available for input source');
                    return;
                }

                const profilePromises = inputSource.profiles.map(async (profileId: string) => {
                    const profileUrl = `${this.basePath}/${profileId}/profile.json`;

                    try {
                        const response = await fetch(profileUrl);
                        if (!response.ok) {
                            return null;
                        }

                        const profile = await response.json();
                        const layoutPath = profile.layouts?.[inputSource.handedness]?.assetPath || '';
                        const assetPath = `${this.basePath}/${profile.profileId}/${inputSource.handedness}${layoutPath.replace(/^\/?(left|right)/, '')}`;

                        const asset = await new Promise<any>((resolve, reject) => {
                            this.app.assets.loadFromUrl(assetPath, 'container', (err: unknown, loadedAsset: any) => {
                                if (err) reject(err);
                                else resolve(loadedAsset);
                            });
                        });

                        return { profileId, asset };
                    } catch {
                        console.warn(`Failed to process profile ${profileId}`);
                        return null;
                    }
                });

                const results = await Promise.all(profilePromises);
                const successfulResult = results.find(result => result !== null);

                if (!successfulResult) {
                    console.warn('No compatible profiles found');
                    return;
                }

                const { asset } = successfulResult;
                const container = asset?.resource;
                if (!container || typeof container.instantiateRenderEntity !== 'function') {
                    console.warn('Controller profile loaded without a renderable container');
                    return;
                }

                const entity = container.instantiateRenderEntity();
                this.app.root.addChild(entity);

                const jointMap = new Map<any, any>();
                if (inputSource.hand) {
                    for (const joint of inputSource.hand.joints) {
                        const jointEntity = entity.findByName(joint.id);
                        if (jointEntity) {
                            jointMap.set(joint, jointEntity);
                        }
                    }
                }

                this.controllers.set(inputSource, { entity, jointMap });
            } catch (err) {
                console.warn('[XR] controller setup failed', err);
            }
        });

        this.app.xr.input.on('remove', (inputSource) => {
            const controller = this.controllers.get(inputSource);
            if (controller) {
                controller.entity.destroy();
                this.controllers.delete(inputSource);
            }
        });
    }

    update() {
        if (!this.app.xr?.active) {
            return;
        }

        for (const [inputSource, { entity, jointMap }] of this.controllers) {
            if (inputSource.hand) {
                for (const [joint, jointEntity] of jointMap) {
                    try {
                        jointEntity.setPosition(joint.getPosition());
                        jointEntity.setRotation(joint.getRotation());
                    } catch {
                        // ignore; joint pose may be unavailable
                    }
                }
            } else {
                const pos = getInputPosition(inputSource);
                if (pos) {
                    entity.setPosition(pos);
                }
                const rot = getInputRotation(inputSource);
                if (rot) {
                    entity.setRotation(rot);
                }
            }
        }
    }
}

export { XrControllers };
