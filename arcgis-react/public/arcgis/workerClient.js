(function () {
    function createSatWorkerClient(url) {
        var w = new Worker(url || '/arcgis/worker.js');
        var onPos = function () { };
        var onTrack = function () { };
        w.onmessage = function (ev) {
            var data = ev.data || {};
            if (data.type === 'positions' && data.positions) {
                try { onPos(new Float32Array(data.positions)); } catch (e) { }
            } else if (data.type === 'track') {
                try { onTrack(data.id, data.positions ? new Float32Array(data.positions) : null); } catch (e) { }
            }
        };
        return {
            init: function (seeds) { try { w.postMessage({ type: 'init', payload: seeds || [] }); } catch (e) { } },
            onPositions: function (cb) { onPos = typeof cb === 'function' ? cb : onPos; },
            onTrack: function (cb) { onTrack = typeof cb === 'function' ? cb : onTrack; },
            requestTick: function (timeMs) { try { w.postMessage({ type: 'tick', time: timeMs || Date.now() }); } catch (e) { } },
            requestTrack: function (id) { try { w.postMessage({ type: 'track', id: id }); } catch (e) { } },
            dispose: function () { try { w.terminate(); } catch (e) { } }
        };
    }
    window.ArcgisWorkerClient = { createSatWorkerClient: createSatWorkerClient };
})();




