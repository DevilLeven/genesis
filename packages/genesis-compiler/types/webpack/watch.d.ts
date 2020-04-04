import { SSR, Renderer } from '@fmfe/genesis-core';
import { ClientConfig } from '../webpack';
import { BaseGenesis } from '../utils';
export declare class WatchClientConfig extends ClientConfig {
    constructor(ssr: SSR);
}
export declare class Watch extends BaseGenesis {
    devMiddleware: any;
    hotMiddleware: any;
    private watchData;
    private _renderer;
    constructor(ssr: SSR);
    get renderer(): Renderer;
    set renderer(renderer: Renderer);
    start(): Promise<void>;
    destroy(): void;
    private notify;
}
