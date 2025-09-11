(function () {
    function createGlobeScene(container, Map, SceneView, GraphicsLayer) {
        var map = new Map({ basemap: 'satellite', ground: 'world-elevation' });
        var view = new SceneView({
            container: container,
            map: map,
            qualityProfile: 'high',
            constraints: { altitude: { max: 12000000000 } },
            environment: {
                lighting: { date: new Date(), directShadowsEnabled: false },
                atmosphereEnabled: true,
                starsEnabled: true,
            },
            popup: { dockEnabled: true, dockOptions: { breakpoint: false } },
        });

        var satelliteLayer = new GraphicsLayer();
        var debrisLayer = new GraphicsLayer();
        var tracksLayer = new GraphicsLayer();
        map.addMany([satelliteLayer, debrisLayer, tracksLayer]);

        return { view: view, map: map, layers: { satellites: satelliteLayer, debris: debrisLayer, tracks: tracksLayer } };
    }

    function addSatGraphic(layer, Graphic, geometry, attrs) {
        var g = new Graphic({
            geometry: geometry,
            symbol: { type: 'picture-marker', url: 'https://i.ibb.co/0y1d3Zk/Sat-PNG.png', width: 8, height: 8 },
            attributes: attrs || {},
            popupEnabled: false,
        });
        layer.add(g);
        return g;
    }

    function addDebrisGraphic(layer, Graphic, geometry, attrs) {
        var g = new Graphic({
            geometry: geometry,
            symbol: { type: 'simple-marker', style: 'circle', color: [200, 200, 200, 0.7], size: 2 },
            attributes: attrs || {},
        });
        layer.add(g);
        return g;
    }

    window.ArcgisLayers = {
        createGlobeScene: createGlobeScene,
        addSatGraphic: addSatGraphic,
        addDebrisGraphic: addDebrisGraphic,
    };
})();




