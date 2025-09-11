(function () {
    function createGeometryChunker(graphics, wkid) {
        var pending = null;
        var cursor = 0;
        var raf = 0;
        var interacting = false;
        var BASE = 200;

        function size() {
            return interacting ? Math.max(50, Math.floor(BASE / 2)) : BASE;
        }

        function step() {
            if (!pending) return;
            var end = Math.min(cursor + size(), graphics.length);
            for (var i = cursor; i < end; i++) {
                var j = i * 3;
                var x = pending[j], y = pending[j + 1], z = pending[j + 2];
                if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) {
                    graphics[i].geometry = { type: 'point', x: x, y: y, z: z, spatialReference: { wkid: wkid || 4326 } };
                }
            }
            cursor = end;
            if (pending && cursor < graphics.length) {
                raf = requestAnimationFrame(step);
            } else {
                pending = null;
            }
        }

        return {
            feed: function (arr) {
                pending = arr;
                cursor = 0;
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(step);
            },
            setInteracting: function (v) {
                interacting = !!v;
                if (!interacting && pending) {
                    cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(step);
                }
            },
            dispose: function () {
                try { cancelAnimationFrame(raf); } catch (e) { }
                pending = null;
            }
        };
    }

    window.ArcgisChunker = { createGeometryChunker: createGeometryChunker };
})();




