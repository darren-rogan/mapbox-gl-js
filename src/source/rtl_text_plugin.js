// @flow

import {Event, Evented} from '../util/evented';
import {getArrayBuffer} from '../util/ajax';
import browser from '../util/browser';
import window from '../util/window';
import assert from 'assert';
import {isWorker} from '../util/util';

const status = {
    unavailable: 'unavailable', // Not loaded
    deferred: 'deferred', // The plugin URL has been specified, but loading has been deferred
    loading: 'loading', // request in-flight
    loaded: 'loaded',
    error: 'error'
};

export type PluginState = {
    pluginStatus: $Values<typeof status>;
    pluginURL: ?string,
    pluginBlobURL: ?string
};

type ErrorCallback = (error: ?Error) => void;
type PluginStateSyncCallback = (state: PluginState) => void;
let _completionCallback = null;

//Variables defining the current state of the plugin
let pluginStatus = status.unavailable;
let pluginURL = null;
let pluginBlobURL = null;

export const triggerPluginCompletionEvent = function(error: ?Error) {
    if (_completionCallback) {
        _completionCallback(error);
    }
};

function sendPluginStateToWorker() {
    evented.fire(new Event('pluginStateChange', {pluginStatus, pluginURL, pluginBlobURL}));
}

export const evented = new Evented();

export const getRTLTextPluginStatus = function () {
    return pluginStatus;
};

export const registerForPluginStateChange = function(callback: PluginStateSyncCallback) {
    // Do an initial sync of the state
    callback({pluginStatus, pluginURL, pluginBlobURL});
    // Listen for all future state changes
    evented.on('pluginStateChange', callback);
    return callback;
};

export const clearRTLTextPlugin = function() {
    pluginStatus = status.unavailable;
    pluginURL = null;
    if (pluginBlobURL) {
        window.URL.revokeObjectURL(pluginBlobURL);
    }
    pluginBlobURL = null;
};

export const setRTLTextPlugin = function(url: string, callback: ?ErrorCallback, deferred: boolean = false) {
    if (pluginStatus === status.deferred || pluginStatus === status.loading || pluginStatus === status.loaded) {
        throw new Error('setRTLTextPlugin cannot be called multiple times.');
    }
    pluginURL = browser.resolveURL(url);
    pluginStatus = status.deferred;
    _completionCallback = callback;
    sendPluginStateToWorker();

    //Start downloading the plugin immediately if not intending to lazy-load
    if (!deferred) {
        downloadRTLTextPlugin();
    }
};

export const downloadRTLTextPlugin = function() {
    if (pluginStatus !== status.deferred || !pluginURL) {
        throw new Error('rtl-text-plugin cannot be downloaded unless a pluginURL is specified');
    }
    pluginStatus = status.loading;
    sendPluginStateToWorker();
    if (pluginURL) {
        getArrayBuffer({url: pluginURL}, (error, data) => {
            if (error) {
                triggerPluginCompletionEvent(error);
            } else {
                const rtlBlob = new window.Blob([data], {type: 'application/javascript'});
                pluginBlobURL = window.URL.createObjectURL(rtlBlob);
                pluginStatus = status.loaded;
                sendPluginStateToWorker();
            }
        });
    }
};

export const plugin: {
    applyArabicShaping: ?Function,
    processBidirectionalText: ?(string, Array<number>) => Array<string>,
    processStyledBidirectionalText: ?(string, Array<number>, Array<number>) => Array<[string, Array<number>]>,
    isLoaded: () => boolean,
    isLoading: () => boolean,
    setState: (state: PluginState) => void,
    isParsed: () => boolean,
    getURLs: () => { blob: ?string, host: ?string }
} = {
    applyArabicShaping: null,
    processBidirectionalText: null,
    processStyledBidirectionalText: null,
    isLoaded() {
        return pluginStatus === status.loaded || // Main Thread: loaded if the completion callback returned successfully
            plugin.applyArabicShaping != null; // Web-worker: loaded if the plugin functions have been compiled
    },
    isLoading() { // Main Thread Only: query the loading status, this function does not return the correct value in the worker context.
        return pluginStatus === status.loading;
    },
    setState(state: PluginState) { // Worker thread only: this tells the worker threads that the plugin is available on the Main thread
        assert(isWorker(), 'Cannot set the state of the rtl-text-plugin when not in the web-worker context');

        pluginStatus = state.pluginStatus;
        pluginURL = state.pluginURL;
        pluginBlobURL = state.pluginBlobURL;
    },
    isParsed(): boolean {
        assert(isWorker(), 'rtl-text-plugin is only parsed on the worker-threads');

        return plugin.applyArabicShaping != null &&
            plugin.processBidirectionalText != null &&
            plugin.processStyledBidirectionalText != null;
    },
    getURLs(): { blob: ?string, host: ?string } {
        assert(isWorker(), 'rtl-text-plugin urls can only be queried from the worker threads');

        return {
            blob: pluginBlobURL,
            host: pluginURL,
        };
    }
};
