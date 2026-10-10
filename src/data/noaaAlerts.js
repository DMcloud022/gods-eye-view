import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

const API_URL = '/api/noaa-alerts';

let _dataSource = null;
let _enabled = false;
let _count = 0;
let _lastUpdate = null;
let _lastError = null;

const SEVERITY_COLORS = {
  Extreme: '#ff1a1a',
  Severe: '#ff8c00',
  Moderate: '#ffd700',
  Minor: '#87ceeb',
  Unknown: '#aaaaaa',
};

function severityColor(severity) {
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.Unknown;
}

function ringCentroid(ring) {
  let sumLon = 0;
  let sumLat = 0;
  for (const [lon, lat] of ring) {
    sumLon += lon;
    sumLat += lat;
  }
  return [sumLon / ring.length, sumLat / ring.length];
}

function ringToFlatCoords(ring) {
  const flat = [];
  for (const [lon, lat] of ring) {
    flat.push(lon, lat);
  }
  return flat;
}

function addAlertPolygon(ring, feature, polygonIndex) {
  const flatCoords = ringToFlatCoords(ring);
  const [centroidLon, centroidLat] = ringCentroid(ring);
  const color = Cesium.Color.fromCssColorString(severityColor(feature.properties.severity));

  _dataSource.entities.add({
    id: `noaa-${feature.properties.id}-${polygonIndex}`,
    polygon: new Cesium.PolygonGraphics({
      hierarchy: new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray(flatCoords),
      ),
      material: color.withAlpha(0.25),
      outline: true,
      outlineColor: color.withAlpha(0.85),
      outlineWidth: 2,
      height: 0,
      classificationType: Cesium.ClassificationType.TERRAIN,
    }),
    label: new Cesium.LabelGraphics({
      text: feature.properties.event,
      font: '11px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      eyeOffset: new Cesium.Cartesian3(0, 0, -1000),
      pixelOffset: new Cesium.Cartesian2(0, 0),
      show: true,
    }),
    position: Cesium.Cartesian3.fromDegrees(centroidLon, centroidLat, 0),
    description: `${feature.properties.event}: ${feature.properties.headline || ''}`,
    layerId: 'noaa-alerts',
  });
}

export default {
  id: 'noaa-alerts',
  name: 'Weather Alerts',
  label: 'Weather Alerts',
  shortLabel: 'ALERTS',
  source: 'NOAA/NWS',
  group: 'environment',
  icon: '⛈',
  updateInterval: 180000,
  showInTogglePanel: true,

  init(viewer) {
    _dataSource = new Cesium.CustomDataSource('noaa-alerts');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _enabled = false;
  },

  enable() {
    _enabled = true;
    if (_dataSource) _dataSource.show = true;
  },

  disable() {
    _enabled = false;
    if (_dataSource) _dataSource.show = false;
  },

  async update(viewer, { signal } = {}) {
    if (!_enabled) return false;

    let response;
    try {
      response = await fetch(API_URL, { signal: signal ?? AbortSignal.timeout(15000) });
    } catch (e) {
      if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return false;
      _lastError = 'NOAA Alerts network error';
      return false;
    }

    if (!response.ok) {
      _lastError = `NOAA Alerts HTTP ${response.status}`;
      return false;
    }

    let geojson;
    try {
      geojson = await response.json();
    } catch (e) {
      _lastError = 'NOAA Alerts JSON parse error';
      return false;
    }

    _dataSource.entities.removeAll();

    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    if (features.length === 0) {
      _count = 0;
      _lastUpdate = Date.now();
      _lastError = null;
      return true;
    }

    let count = 0;

    for (const feature of features) {
      if (!feature.geometry) continue;
      const { type, coordinates } = feature.geometry;

      if (type === 'Polygon') {
        const ring = coordinates[0];
        if (!ring || ring.length < 3) continue;
        addAlertPolygon(ring, feature, 0);
        count++;
      } else if (type === 'MultiPolygon') {
        for (let i = 0; i < coordinates.length; i++) {
          const ring = coordinates[i][0];
          if (!ring || ring.length < 3) continue;
          addAlertPolygon(ring, feature, i);
          count++;
        }
      }
    }

    _count = count;
    _lastUpdate = Date.now();
    _lastError = null;
    governorRequestRender('noaa-alerts');
    return true;
  },

  getStats() {
    return { count: _count, lastUpdate: _lastUpdate, lastError: _lastError };
  },
};
