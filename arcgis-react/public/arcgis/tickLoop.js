(function () {
    function createVisibilityTickLoop(cb, intervalMs) {
        var t = null;
        var ms = intervalMs || 1000;
        function start() { stop(); t = setInterval(cb, ms); }
        function stop() { if (t) { clearInterval(t); t = null; } }
        function vis() { if (document.hidden) stop(); else start(); }
        document.addEventListener('visibilitychange', vis);
        start();
        return { start: start, stop: stop, dispose: function () { stop(); document.removeEventListener('visibilitychange', vis); } };
    }
    window.ArcgisTickLoop = { createVisibilityTickLoop: createVisibilityTickLoop };
})();




