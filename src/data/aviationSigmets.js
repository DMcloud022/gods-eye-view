import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

const API_URL = '/api/sigmet';

let _dataSource = null;
let _enabled = false;
let _count = 0;
let _lastUpdate = null;
let _lastError = null;

const HAZARD_COLORS = {
  TS: '#ff6600',
  ASH: '#888888',
  TURB: '#ffdd00',
  ICE: '#00ccff',
  IFR: '#cc66ff',
};

function hazardColor(hazard) {
  return HAZARD_COLORS[hazard] ?? '#aaaaaa';
}

function hazardLabel(hazard, qualifier) {
  const h = String(hazard || 'SIGMET');
  return qualifier ? `${h} (${qualifier})` : h;
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

export default {
  id: 'aviation-sigmets',
  name: 'Aviation SIGMETs',
  label: 'Aviation SIGMETs',
  shortLabel: 'SIGMET',
  source: 'aviationweather.gov',
  group: 'aviation',
  icon: '⚡',
  updateInterval: 360000,
  showInTogglePanel: true,

  init(viewer) {
    _dataSource = new Cesium.CustomDataSource('aviation-sigmets');
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
      _lastError = 'Aviation SIGMETs network error';
      return false;
    }

    if (!response.ok) {
      _lastError = `Aviation SIGMETs HTTP ${response.status}`;
      return false;
    }

    let geojson;
    try {
      geojson = await response.json();
    } catch (e) {
      _lastError = 'Aviation SIGMETs JSON parse error';
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

    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      if (!feature.geometry || feature.geometry.type !== 'Polygon') continue;

      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) continue;

      const { hazard, qualifier, altitudeLow1, altitudeHi1, validTimeFrom, validTimeTo, rawSigmet } = feature.properties;
      const color = Cesium.Color.fromCssColorString(hazardColor(hazard));
      const flatCoords = ringToFlatCoords(ring);
      const [centroidLon, centroidLat] = ringCentroid(ring);
      const labelText = hazardLabel(hazard, qualifier);

      const descParts = [labelText];
      if (altitudeLow1 != null && altitudeHi1 != null) {
        descParts.push(`Altitude: FL${altitudeLow1}–FL${altitudeHi1}`);
      } else if (altitudeHi1 != null) {
        descParts.push(`Altitude: up to FL${altitudeHi1}`);
      }
      if (validTimeFrom && validTimeTo) {
        descParts.push(`Valid: ${validTimeFrom} – ${validTimeTo}`);
      }
      if (rawSigmet) {
        descParts.push(rawSigmet);
      }

      _dataSource.entities.add({
        id: `sigmet-${feature.id || index}`,
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
          text: labelText,
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
        description: descParts.join('\n'),
        layerId: 'aviation-sigmets',
      });

      count++;
    }

    _count = count;
    _lastUpdate = Date.now();
    _lastError = null;
    governorRequestRender('aviation-sigmets');
    return true;
  },

  getStats() {
    return { count: _count, lastUpdate: _lastUpdate, lastError: _lastError };
  },
};
