declare module 'suncalc' {
    interface SunPosition {
        azimuth: number;
        altitude: number;
        distance?: number;
    }

    interface MoonPosition {
        azimuth: number;
        altitude: number;
        distance: number;
    }

    const SunCalc: {
        getPosition(date: Date, latitude: number, longitude: number): SunPosition;
        getMoonPosition(date: Date, latitude: number, longitude: number): MoonPosition;
    };

    export default SunCalc;
}

