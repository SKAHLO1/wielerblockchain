'use client';

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { geoGraticule10, geoOrthographic, geoPath, geoDistance } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import world from 'world-atlas/countries-110m.json';
import { ChainIcon } from './icons';

export interface GlobeMarker {
  id: string;
  name: string;
  status: string;
  tone: 'held' | 'attack' | 'barbarian' | 'idle' | 'home';
  lonlat: [number, number];
  /** Label offset from the marker, in px of the 600x600 globe box. */
  label: [number, number];
}

const SIZE = 600;
const ROTATE: [number, number] = [22, -22];

const land = feature(
  world as unknown as Parameters<typeof feature>[0],
  (world as unknown as { objects: { countries: Parameters<typeof feature>[1] } }).objects.countries,
) as unknown as FeatureCollection<Geometry>;

// Pseudo-random "city lights" on land, deterministic.
function lights(path: ReturnType<typeof geoPath>, projection: ReturnType<typeof geoOrthographic>) {
  const pts: [number, number][] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const centroids = land.features.map((f) => path.centroid(f)).filter((c) => !isNaN(c[0]));
  for (const c of centroids) {
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) pts.push([c[0] + (rnd() - 0.5) * 22, c[1] + (rnd() - 0.5) * 16]);
  }
  void projection;
  return pts;
}

export default function Globe({ markers, compact = false }: { markers: GlobeMarker[]; compact?: boolean }) {
  const { countries, graticule, sphere, arcs, points, cityLights } = useMemo(() => {
    const projection = geoOrthographic()
      .scale(SIZE * 0.46)
      .translate([SIZE / 2, SIZE / 2])
      .rotate(ROTATE)
      .clipAngle(90);
    const path = geoPath(projection);
    const center: [number, number] = [-ROTATE[0], -ROTATE[1]];
    const visible = (ll: [number, number]) => geoDistance(ll, center) < Math.PI / 2 - 0.05;
    const pts = markers.map((m) => ({ m, xy: projection(m.lonlat) as [number, number], vis: visible(m.lonlat) }));
    // Raid lines: home (NEAR) to every chain, plus a ring between foreign chains.
    const home = markers.find((m) => m.tone === 'home') ?? markers[0];
    const pairs: [GlobeMarker, GlobeMarker][] = [];
    markers.forEach((m) => m !== home && pairs.push([home, m]));
    const foreign = markers.filter((m) => m !== home);
    for (let i = 0; i + 1 < foreign.length; i++) pairs.push([foreign[i], foreign[i + 1]]);
    return {
      countries: land.features.map((f) => path(f) || ''),
      graticule: path(geoGraticule10()) || '',
      sphere: path({ type: 'Sphere' }) || '',
      arcs: pairs.map(([a, b]) => path({ type: 'LineString', coordinates: [a.lonlat, b.lonlat] }) || ''),
      points: pts,
      cityLights: lights(path, projection),
    };
  }, [markers]);

  // Keep callouts inside the surrounding panel (the globe itself may bleed past it).
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const panel = (el.closest('.panel') as HTMLElement) ?? el;
      const pr = panel.getBoundingClientRect();
      el.querySelectorAll<HTMLElement>('.globe-label').forEach((l) => {
        l.style.transform = '';
        const r = l.getBoundingClientRect();
        let dx = 0;
        let dy = 0;
        if (r.right > pr.right - 10) dx = pr.right - 10 - r.right;
        if (r.left + dx < pr.left + 10) dx = pr.left + 10 - r.left;
        if (r.top < pr.top + 10) dy = pr.top + 10 - r.top;
        if (r.bottom + dy > pr.bottom - 10) dy = pr.bottom - 10 - r.bottom;
        if (dx || dy) l.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [points]);

  return (
    <div className={`globe ${compact ? 'globe-compact' : ''}`} ref={box}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="globe-svg" aria-label="World map of WIELER territories">
        <defs>
          <radialGradient id="g-ocean" cx="42%" cy="35%" r="70%">
            <stop offset="0" stopColor="#1d4cb3" />
            <stop offset="0.55" stopColor="#0d2a73" />
            <stop offset="1" stopColor="#061642" />
          </radialGradient>
          <linearGradient id="g-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3a74e6" />
            <stop offset="1" stopColor="#173f99" />
          </linearGradient>
          <radialGradient id="g-atmo" cx="50%" cy="50%" r="50%">
            <stop offset="0.86" stopColor="#4d8dff" stopOpacity="0" />
            <stop offset="0.93" stopColor="#4d8dff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#4d8dff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="g-shade" cx="35%" cy="30%" r="80%">
            <stop offset="0.5" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#020818" stopOpacity="0.65" />
          </radialGradient>
          <radialGradient id="g-light" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.35" stopColor="#9cc4ff" />
            <stop offset="1" stopColor="#4d8dff" stopOpacity="0" />
          </radialGradient>
          <filter id="g-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE * 0.5} fill="url(#g-atmo)" />
        <path d={sphere} fill="url(#g-ocean)" />
        <path d={graticule} fill="none" stroke="#5f8eff" strokeOpacity="0.12" strokeWidth="0.7" />
        <g>
          {countries.map((d, i) => (
            <path key={i} d={d} fill="url(#g-land)" stroke="#7fa8ff" strokeOpacity="0.55" strokeWidth="0.6" />
          ))}
        </g>
        <g fill="#cfe2ff" opacity="0.55">
          {cityLights.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.9} />
          ))}
        </g>
        <path d={sphere} fill="url(#g-shade)" />
        <g fill="none" stroke="#e8f0ff" strokeOpacity="0.85" strokeWidth="1.6" strokeDasharray="4 6">
          {arcs.map((d, i) => (
            <path key={i} d={d} className="globe-arc" />
          ))}
        </g>
        {points.map(({ m, xy, vis }) =>
          vis ? (
            <g key={m.id} transform={`translate(${xy[0]} ${xy[1]})`}>
              <circle r="16" fill="url(#g-light)" opacity="0.8" className="globe-pulse" />
              <circle r="5" fill="#fff" stroke={toneColor(m.tone)} strokeWidth="3" />
            </g>
          ) : null,
        )}
      </svg>
      {points.map(({ m, xy, vis }) =>
        vis ? (
          <div
            key={m.id}
            className={`globe-label tone-${m.tone}`}
            style={{
              left: `${((xy[0] + m.label[0]) / SIZE) * 100}%`,
              top: `${((xy[1] + m.label[1]) / SIZE) * 100}%`,
            }}
          >
            <span className="globe-label-icon">
              <ChainIcon id={m.id} size={26} />
            </span>
            <span>
              <strong>{m.name}</strong>
              <small>{m.status}</small>
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

function toneColor(t: GlobeMarker['tone']) {
  switch (t) {
    case 'held':
      return '#3b82f6';
    case 'attack':
      return '#f59e0b';
    case 'barbarian':
      return '#ef4444';
    case 'home':
      return '#22d3ee';
    default:
      return '#94a3b8';
  }
}
