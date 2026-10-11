// 驿道光带：把该时期的城镇、关隘、港口按「最近邻」连成一张路网，
// 既填满空旷的沙盘，也让人一眼看出这一朝城与城之间的走向。
// 纯程序化：每个点连向最近的 k 个点，去重后画成细光带（夜色里更亮一点）。

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';

/**
 * 最近邻连边（纯函数，便于 Node 校验）：每个点连向最近的 k 个点，双向去重。
 * @param {Array<{x:number,z:number}>} points
 */
export function nearestNeighborEdges(points, k = 2) {
  const edges = [];
  const seen = new Set();
  points.forEach((point, index) => {
    const ranked = points
      .map((other, otherIndex) => ({ otherIndex, distance: Math.hypot(point.x - other.x, point.z - other.z) }))
      .filter((item) => item.otherIndex !== index)
      .sort((a, b) => a.distance - b.distance);
    ranked.slice(0, Math.max(1, k)).forEach((item) => {
      const key = index < item.otherIndex ? `${index}:${item.otherIndex}` : `${item.otherIndex}:${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push([Math.min(index, item.otherIndex), Math.max(index, item.otherIndex)]);
    });
  });
  return edges;
}

/** 生成该时期的驿道光带。 */
export function createDynastyRoutes({ scene, places = [], color = '#d8b46a' } = {}) {
  const group = new THREE.Group();
  const worlds = places.map((place) => worldPosition(place.lng, place.lat, RANGES, 0.035));
  const edges = nearestNeighborEdges(
    worlds.map((world) => ({ x: world.x, z: world.z })),
    2,
  );
  const positions = [];
  edges.forEach(([a, b]) => {
    positions.push(worlds[a].x, worlds[a].y, worlds[a].z, worlds[b].x, worlds[b].y, worlds[b].z);
  });

  let material = null;
  let lines = null;
  if (positions.length) {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    material = new LineMaterial({
      color: new THREE.Color(color),
      linewidth: 1.1,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);
    lines = new LineSegments2(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    group.add(lines);
  }
  scene?.add(group);

  return {
    group,
    edges,
    update(nightFactor = 0) {
      if (material) material.opacity = 0.14 + nightFactor * 0.16;
    },
    resize(width, height) {
      material?.resolution.set(width, height);
    },
    dispose() {
      if (lines) {
        group.remove(lines);
        lines.geometry.dispose();
        material.dispose();
      }
      scene?.remove(group);
    },
  };
}
