(function () {
    function drawTrackForGraphic(graphic, tracksLayer, workerClient, GraphicCtor, createTrackPolyline) {
        try { tracksLayer.removeAll(); } catch (e) { }
        if (!workerClient) {
            return; // Fallback path can be added if desired
        }
        workerClient.requestTrack(graphic.attributes.id);
        var off = function () { };
        var handler = function (id, arr) {
            if (id !== graphic.attributes.id) return;
            if (arr && arr.length > 3) {
                var path = [];
                for (var k = 0; k < arr.length; k += 3) {
                    var x = arr[k], y = arr[k + 1], z = arr[k + 2];
                    if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(z)) path.push([x, y, z]);
                }
                if (path.length > 1) {
                    var line = new GraphicCtor({
                        geometry: createTrackPolyline(path),
                        symbol: { type: 'line-3d', symbolLayers: [{ type: 'line', size: 2, material: { color: [192, 192, 192, 0.6] } }] },
                    });
                    tracksLayer.add(line);
                }
            }
            try { workerClient.onTrack(off); } catch (e) { }
        };
        off = handler;
        workerClient.onTrack(handler);
    }

    window.ArcgisTracks = { drawTrackForGraphic: drawTrackForGraphic };
})();




