/* eslint-disable @typescript-eslint/prefer-for-of */
import Vue from 'vue';
import { ClientOptions, RenderContext } from '@fmfe/genesis-core';
import { beforeRender } from './format';
const remoteViewStateKey = '__remote_view_state__';

const isPromise = (obj: any) => {
    return (
        !!obj &&
        (typeof obj === 'object' || typeof obj === 'function') &&
        typeof obj.then === 'function'
    );
};

export interface RemoteViewData {
    automount: boolean;
    html: string;
    id: string;
    name: string;
    style: string;
    script: string;
    url: string;
    state: { [x: string]: any };
}

/**
 * el 加载的元素
 * bool 在 doc 中是否已经存在
 */
const onload = (el, bool: boolean): Promise<boolean> => {
    // 暂时先处理成已经加载成功
    if (bool === true && !('_loading' in el)) {
        return Promise.resolve(true);
    }
    // 已经加载成功
    if (el._loading === false) {
        return Promise.resolve(true);
    }
    // 正在加载中
    if (el._loading === true) {
        return new Promise((resolve) => {
            el._loadArr.push(resolve);
            el._loadArr = [];
        });
    }
    // 首次加载
    return new Promise((resolve, reject) => {
        const load = () => {
            el._loadArr.forEach((fn) => fn());
            el._loading = false;
            resolve(true);
        };
        const error = () => {
            el._loadArr.forEach((fn) => fn());
            el._loading = false;
            resolve(false);
        };
        el.addEventListener('load', load, false);
        el.addEventListener('error', error, false);
        el._loading = true;
        el._loadArr = [];
    });
};

/**
 * 加载样式文件
 */
export const loadStyle = (html: string): Promise<boolean[]> => {
    const doc = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = html;
    const arr: Promise<boolean>[] = [];
    const linkArr = (document.querySelectorAll(
        'link[rel=stylesheet][href]'
    ) as any) as HTMLLinkElement[];
    const findOne = (href: string): HTMLLinkElement | null => {
        for (let i = 0; i < linkArr.length; i++) {
            if (linkArr[i].href === href) {
                return linkArr[i];
            }
        }
        return null;
    };
    const installArr: Element[] = [];
    const forEach = (el: Element) => {
        if (
            el instanceof HTMLLinkElement &&
            el.rel === 'stylesheet' &&
            el.href
        ) {
            const docLink = findOne(el.href);
            if (docLink) {
                arr.push(onload(docLink, true));
                return;
            } else {
                arr.push(onload(el, false));
            }
        }
        installArr.push(el);
    };
    for (let i = 0; i < div.children.length; i++) {
        forEach(div.children[i]);
    }
    installArr.forEach((el) => {
        doc.appendChild(el);
    });
    document.head.appendChild(doc);
    return Promise.all<boolean>(arr);
};

/**
 * 加载js文件
 */
export const loadScript = (html: string): Promise<boolean[]> => {
    const doc = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = html;
    const arr: Promise<boolean>[] = [];
    const scriptArr = (document.querySelectorAll(
        'script[src]'
    ) as any) as HTMLScriptElement[];
    const findOne = (src: string): HTMLScriptElement | null => {
        for (let i = 0; i < scriptArr.length; i++) {
            if (scriptArr[i].src === src) {
                return scriptArr[i];
            }
        }
        return null;
    };
    const installArr: Element[] = [];
    const forEach = (el: Element) => {
        if (el instanceof HTMLScriptElement && el.src) {
            const docLink = findOne(el.src);
            if (docLink) {
                arr.push(onload(docLink, true));
                return;
            } else {
                const newScript = document.createElement('script');
                const attrs = Object.values(el.attributes);
                newScript.async = false;
                attrs.forEach((attr) => {
                    const value = el.getAttribute(attr.name)!;
                    newScript.setAttribute(attr.name, value);
                });
                newScript.src = el.src;
                arr.push(onload(newScript, false));
                installArr.push(newScript);
                return;
            }
        }
        installArr.push(el);
    };
    for (let i = 0; i < div.children.length; i++) {
        forEach(div.children[i]);
    }
    installArr.forEach((el) => {
        doc.appendChild(el);
    });
    document.body.appendChild(doc);
    return Promise.all<boolean>(arr);
};

/**
 * 远程调用组件
 */
export const RemoteView: any = {
    name: 'remote-view',
    props: {
        fetch: {
            type: Function
        },
        clientFetch: {
            type: Function
        },
        serverFetch: {
            type: Function
        }
    },
    data() {
        return {
            // 安装的选项
            installOptions: {},
            // 远程请求到的数据
            localData: {
                style: '',
                script: '',
                html: ''
            },
            // 组件渲染的下标
            index: 0,
            // 应用安装的id
            appId: 0,
            // 当前组件是否已销毁
            destroyed: false,
            // 是否需要客户端加载远程组件
            needClientLoad: true
        };
    },
    created() {
        if (process.env.VUE_ENV === 'client') {
            if (!this.$root.$options.clientOptions) return;
            this.initClient();
        }
        if (process.env.VUE_ENV === 'server') {
            if (!this.$root.$options.renderContext) return;
            this.initServer();
        }
    },
    render(h) {
        return h('div', {
            domProps: {
                innerHTML: this.localData.html
            }
        });
    },
    mounted() {
        if (this.needClientLoad) {
            this.clientLoad();
        } else {
            this.$nextTick(this.install);
        }
    },
    beforeDestroy() {
        if (this.appId) {
            (window as any).genesis.uninstall(this.appId);
        }
        this.destroyed = true;
    },
    methods: {
        _fetch(): Promise<RemoteViewData | null> {
            try {
                let fetch = this.fetch;
                if (
                    process.env.VUE_ENV === 'server' &&
                    typeof this.serverFetch === 'function'
                ) {
                    fetch = this.serverFetch;
                }
                if (
                    process.env.VUE_ENV === 'client' &&
                    typeof this.clientFetch === 'function'
                ) {
                    fetch = this.clientFetch;
                }
                if (typeof fetch !== 'function') {
                    return Promise.resolve(null);
                }
                const res = fetch();
                if (isPromise(res)) {
                    return res
                        .then((data: RemoteViewData | null) => {
                            if (typeof data !== 'object') return null;
                            return data;
                        })
                        .catch((e: Error) => {
                            console.error(
                                '[remote-view] Error calling fetch',
                                e
                            );
                            return null;
                        });
                }
                return Promise.resolve(null);
            } catch (e) {
                console.error('[remote-view] Error calling fetch', e);
                return Promise.resolve(null);
            }
        },
        install() {
            this.$nextTick(() => {
                const options = {
                    ...this.installOptions,
                    mounted: (app: Vue) => {
                        Object.keys(this.$listeners).forEach((name) => {
                            app.$on(name, this.$listeners[name]);
                        });
                    }
                };
                if (!this.$el.firstChild) return;
                Object.defineProperty(options, 'el', {
                    enumerable: false,
                    value: this.$el.firstChild
                });
                if (options.el && (window as any).genesis && !this.destroyed) {
                    this.$emit('install', options);
                    this.appId = (window as any).genesis.install(options);
                }
            });
        },
        initServer() {
            const context: RenderContext = this.$root.$options.renderContext;
            const state = context.data.state;
            const first = !state[remoteViewStateKey];
            state[remoteViewStateKey] = state[remoteViewStateKey] || [];

            this.index = state[remoteViewStateKey].length;
            state[remoteViewStateKey].push(this.localData);

            Object.defineProperty(this.localData, 'style', {
                enumerable: false
            });
            Object.defineProperty(this.localData, 'script', {
                enumerable: false
            });
            Object.defineProperty(this.localData, 'html', {
                enumerable: false
            });
            if (!first) return;
            /**
             * 渲染完成后，对js和样式进行去重
             */
            context.beforeRender(beforeRender);
        },
        initClient() {
            const clientOptions: ClientOptions = this.$root.$options
                .clientOptions;
            const state = clientOptions.state;
            // 热更新可能会不存在数组，或者数组已经被清空了。
            if (!state[remoteViewStateKey] || !state[remoteViewStateKey].length)
                return;
            const data = state[remoteViewStateKey].splice(0, 1)[0];
            // 这里服务器端加载失败，要调整到客户端加载
            if (!data.id) return;
            const el: any = document.querySelector(
                `[data-ssr-genesis-id="${data.id}"]`
            );
            if (!el) return;
            this.localData.html = el.parentNode.innerHTML;
            this.installOptions = { ...data };
            // 服务器端已经加载，客户端不需要再重新加载
            this.needClientLoad = false;
        },
        clientLoad() {
            const haveFlase = (arr: boolean[]) => {
                for (let i = 0; i < arr.length; i++) {
                    if (arr[i] === false) {
                        return true;
                    }
                }
                return false;
            };
            return this._fetch().then((data: RemoteViewData) => {
                if (data === null) return;
                Promise.all([
                    loadStyle(data.style).then((arr) => {
                        this.localData = { ...data };
                        return !haveFlase(arr);
                    }),
                    loadScript(data.script).then((arr) => {
                        (window as any)[data.id] = data.state;
                        return !haveFlase(arr);
                    })
                ]).then((arr) => {
                    this.installOptions = { ...data };
                    this.install();
                    if (haveFlase(arr)) {
                        this.$emit('error');
                    }
                });
            });
        }
    },
    serverPrefetch(this: any) {
        return this._fetch().then((data: RemoteViewData | null) => {
            if (data === null) return;
            const context: RenderContext = this.$root.$options.renderContext;
            if (!context && typeof context !== 'object') {
                throw new TypeError(
                    '[remote-view] Need to pass context to the root instance of vue'
                );
            }
            data.automount = false;
            Object.assign(this.localData, data);
        });
    }
};

export default {
    install(_Vue: typeof Vue): void {
        _Vue.component('remote-view', Vue.extend(RemoteView));
    }
};
