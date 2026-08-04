// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import type { EventSlice, SignalSlice } from '../shared/types';

const WIDTH = 820;
const LANE_H = 72;
const LANE_GAP = 4;
const MARGIN = { top: 8, right: 16, bottom: 28, left: 60 };

const CHANNEL_COLORS: Record<string, string> = {
  spo2: '#4ade80',
  saturation: '#4ade80',
  oximetry: '#4ade80',
  'o2 sat': '#4ade80',
  flow: '#60a5fa',
  airflow: '#60a5fa',
  'nasal flow': '#60a5fa',
  oronasal: '#60a5fa',
  ptaf: '#60a5fa',
  'nasal pressure': '#60a5fa',
  thorax: '#f97316',
  chest: '#f97316',
  'resp effort': '#f97316',
  thoracic: '#f97316',
  abdomen: '#facc15',
  abdominal: '#facc15',
  position: '#14b8a6',
  'body pos': '#14b8a6',
  'body position': '#14b8a6',
  body: '#14b8a6',
};

function channelColor(label: string): string {
  return CHANNEL_COLORS[label.toLowerCase()] ?? '#94a3b8';
}

function eventBandColor(
  type: string,
  magnitude: number,
): { fill: string; stroke: string; label: string } {
  if (type === 'provisional_desaturation') {
    return { fill: 'rgba(168,85,247,0.15)', stroke: '#a855f7', label: 'Desat' };
  }
  if (type === 'positional') {
    return { fill: 'rgba(20,184,166,0.15)', stroke: '#14b8a6', label: 'Positional' };
  }
  if (magnitude >= 0.9) {
    return { fill: 'rgba(239,68,68,0.15)', stroke: '#ef4444', label: 'Apnea' };
  }
  return { fill: 'rgba(234,179,8,0.15)', stroke: '#eab308', label: 'Hypopnea' };
}

function yRange(slice: SignalSlice): [number, number] {
  const label = slice.channel.toLowerCase();
  const isSpo2 =
    label.includes('spo2') ||
    label.includes('saturation') ||
    label.includes('oximetry') ||
    label === 'o2 sat';
  if (isSpo2) {
    const valid = slice.samples.filter((v: number) => Number.isFinite(v));
    const lo = valid.length ? Math.min(...valid) : 80;
    return [Math.min(lo - 2, 88), 100];
  }
  const valid = slice.samples.filter((v: number) => Number.isFinite(v));
  if (!valid.length) return [-1, 1];
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const pad = (hi - lo) * 0.12 || 0.1;
  return [lo - pad, hi + pad];
}

function buildPath(
  slice: SignalSlice,
  plotW: number,
  plotH: number,
  globalStart: number,
  globalEnd: number,
): string {
  const span = globalEnd - globalStart;
  const [yMin, yMax] = yRange(slice);
  const ySpan = yMax - yMin || 1;
  const n = slice.samples.length;

  const xOf = (i: number): number => {
    const t = slice.windowStartSec + (i / (n - 1)) * (slice.windowEndSec - slice.windowStartSec);
    return ((t - globalStart) / span) * plotW;
  };
  const yOf = (v: number): number => plotH - ((v - yMin) / ySpan) * plotH;

  let d = '';
  let inPath = false;
  for (let i = 0; i < n; i++) {
    const v = slice.samples[i] as number | undefined;
    if (v === undefined || !Number.isFinite(v)) {
      inPath = false;
      continue;
    }
    const x = xOf(i).toFixed(2);
    const y = yOf(v).toFixed(2);
    if (!inPath) {
      d += `M ${x} ${y}`;
      inPath = true;
    } else {
      d += ` L ${x} ${y}`;
    }
  }
  return d;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  event: EventSlice;
  index: number;
}

export function EventWaveformSnapshot({ event, index }: Props) {
  const slices = event.signalSlices;
  if (!slices.length) return null;

  const globalStart = Math.min(...slices.map((s) => s.windowStartSec));
  const globalEnd = Math.max(...slices.map((s) => s.windowEndSec));
  const span = globalEnd - globalStart;

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const totalLanesH = slices.length * LANE_H + Math.max(0, slices.length - 1) * LANE_GAP;
  const svgH = MARGIN.top + totalLanesH + MARGIN.bottom;

  const band = eventBandColor(event.type, event.magnitude);
  const isTagged = event.tags.length > 0;

  // X-axis ticks every 10s (5s if window < 90s)
  const tickStep = span <= 90 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(globalStart / tickStep) * tickStep; t <= globalEnd; t += tickStep) {
    ticks.push(t);
  }

  const xScale = (t: number) => ((t - globalStart) / span) * plotW;
  const eventX1 = Math.max(0, xScale(event.startSec));
  const eventX2 = Math.min(plotW, xScale(event.endSec));

  return (
    <div style={{ pageBreakInside: 'avoid', marginBottom: 20 }}>
      <div
        style={{
          fontSize: 11,
          color: '#64748b',
          marginBottom: 3,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 600, color: band.stroke }}>
          {index + 1}. {band.label}
        </span>
        <span>
          {formatTime(event.startSec)} – {formatTime(event.endSec)}
        </span>
        <span>{(event.endSec - event.startSec).toFixed(1)}s</span>
        {isTagged && (
          <span style={{ color: '#94a3b8', fontSize: 10 }}>
            ({event.tags.map((t) => t.replace('tag:', '')).join(', ')})
          </span>
        )}
      </div>
      <svg
        width={WIDTH}
        height={svgH}
        style={{ display: 'block', background: '#0f172a', borderRadius: 4 }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Per-channel lanes */}
          {slices.map((slice: SignalSlice, li: number) => {
            const laneY = li * (LANE_H + LANE_GAP);
            const [yMin, yMax] = yRange(slice);
            const ySpan = yMax - yMin || 1;
            const pathD = buildPath(slice, plotW, LANE_H, globalStart, globalEnd);
            const color = channelColor(slice.channel);

            // Baseline zero line (for flow/effort channels) at y=0 if in range
            const showZero = yMin < 0 && yMax > 0;
            const zeroY = LANE_H - ((0 - yMin) / ySpan) * LANE_H;

            return (
              <g key={slice.channel} transform={`translate(0,${laneY})`}>
                {/* Lane background */}
                <rect width={plotW} height={LANE_H} fill="#111827" rx={2} />

                {/* Event band */}
                <rect
                  x={eventX1}
                  width={Math.max(1, eventX2 - eventX1)}
                  height={LANE_H}
                  fill={band.fill}
                />

                {/* Event boundary lines */}
                {eventX1 > 0 && eventX1 < plotW && (
                  <line
                    x1={eventX1}
                    x2={eventX1}
                    y1={0}
                    y2={LANE_H}
                    stroke={band.stroke}
                    strokeWidth={1}
                    strokeDasharray="3,2"
                  />
                )}
                {eventX2 > 0 && eventX2 < plotW && (
                  <line
                    x1={eventX2}
                    x2={eventX2}
                    y1={0}
                    y2={LANE_H}
                    stroke={band.stroke}
                    strokeWidth={1}
                    strokeDasharray="3,2"
                  />
                )}

                {/* Zero baseline */}
                {showZero && (
                  <line x1={0} x2={plotW} y1={zeroY} y2={zeroY} stroke="#1e293b" strokeWidth={1} />
                )}

                {/* Signal trace */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.2}
                  strokeLinejoin="round"
                />

                {/* Channel label */}
                <text
                  x={-6}
                  y={LANE_H / 2}
                  fill={color}
                  fontSize={10}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {slice.channel}
                </text>

                {/* Y range labels */}
                <text x={-6} y={4} fill="#475569" fontSize={8} textAnchor="end">
                  {yMax.toFixed(yMax > 10 ? 0 : 1)}
                </text>
                <text x={-6} y={LANE_H - 2} fill="#475569" fontSize={8} textAnchor="end">
                  {yMin.toFixed(yMin > 10 ? 0 : 1)}
                </text>
              </g>
            );
          })}

          {/* X-axis grid lines (span all lanes) */}
          {ticks.map((t: number) => (
            <line
              key={t}
              x1={xScale(t)}
              x2={xScale(t)}
              y1={0}
              y2={totalLanesH}
              stroke="#1e293b"
              strokeWidth={1}
            />
          ))}

          {/* X-axis tick labels */}
          {ticks.map((t: number) => (
            <text
              key={`tl-${t}`}
              x={xScale(t)}
              y={totalLanesH + 16}
              fill="#64748b"
              fontSize={9}
              textAnchor="middle"
            >
              {formatTime(t)}
            </text>
          ))}

          {/* Border around the whole plot area */}
          <rect width={plotW} height={totalLanesH} fill="none" stroke="#1e293b" strokeWidth={1} />
        </g>
      </svg>
    </div>
  );
}
