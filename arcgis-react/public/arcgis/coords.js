(function () {
    function getSatPointFromTle(date, tle1, tle2) {
        try {
            var satrec = window.satellite.twoline2satrec(tle1, tle2);
            var pv = window.satellite.propagate(
                satrec,
                date.getUTCFullYear(),
                date.getUTCMonth() + 1,
                date.getUTCDate(),
                date.getUTCHours(),
                date.getUTCMinutes(),
                date.getUTCSeconds()
            );
            var positionEci = pv.position;
            if (!positionEci) return null;
            var gmst = window.satellite.gstime(date);
            var gd = window.satellite.eciToGeodetic(positionEci, gmst);
            if (!gd) return null;
            var lon = gd.longitude;
            var lat = gd.latitude;
            var hKm = gd.height;
            if ([lon, lat, hKm].some(function (v) { return Number.isNaN(v); })) return null;
            var rad2deg = 180 / Math.PI;
            while (lon < -Math.PI) lon += 2 * Math.PI;
            while (lon > Math.PI) lon -= 2 * Math.PI;
            return { type: 'point', x: lon * rad2deg, y: lat * rad2deg, z: hKm * 1000, spatialReference: { wkid: 4326 } };
        } catch (e) {
            return null;
        }
    }

    function createTrackPolyline(pointsLngLatZ) {
        return { type: 'polyline', paths: [pointsLngLatZ], spatialReference: { wkid: 4326 } };
    }

    window.ArcgisCoords = {
        getSatPointFromTle: getSatPointFromTle,
        createTrackPolyline: createTrackPolyline,
    };
})();




