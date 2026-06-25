'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  normalizeReach,
  type Pt,
  sampleClosed,
  toPath,
} from '@/app/(landing)/components/mothership/components/goo-marks/use-goo-hover'
import {
  type Edge,
  edgesToPaths,
  isoProject,
  rotate2,
} from '@/app/(landing)/components/mothership/components/iso-marks/use-goo-mark'

/**
 * Internal tuning lab for the Sim brand marks. Renders each mark with live
 * controls — size, plus a full before-hover (rest) and after-hover (hover) value
 * for every geometry parameter AND for stroke width and goo fusion — with a
 * scrub/play for the hover transition and a JSON readout to copy back into the
 * production component constants.
 *
 * Forced light (`light` wrapper): the marks use the dark brand gradient, so they
 * only read on a light surface; this keeps the lab correct regardless of the
 * app's active theme.
 *
 * Not linked from nav — internal route at /landing-preview/marks-lab.
 */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  rest: number
  hover: number
  /** Structural params don't animate — one value drives both rest and hover. */
  structural?: boolean
}

interface LabMark {
  id: string
  label: string
  defaultStroke: number
  defaultGoo: number
  defaultSize: number
  params: ParamDef[]
  build: (p: Record<string, number>) => string
}

function cubeEdges(s: number, ky: number, rot: number, zScale: number, zc: number): Edge[] {
  const corner = (sx: number, sy: number, sz: number): Pt => {
    const [rx, ry] = rotate2(sx * s, sy * s, rot)
    return isoProject(rx, ry, sz * s * zScale + zc, ky)
  }
  const c = [
    corner(-1, -1, -1),
    corner(1, -1, -1),
    corner(1, 1, -1),
    corner(-1, 1, -1),
    corner(-1, -1, 1),
    corner(1, -1, 1),
    corner(1, 1, 1),
    corner(-1, 1, 1),
  ]
  const ed: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ]
  return ed.map(([a, b]) => [c[a], c[b]] as Edge)
}

const MARKS: LabMark[] = [
  {
    id: 'stacked',
    label: 'Stacked planes — Integrate',
    defaultStroke: 1.5,
    defaultGoo: 0.8,
    defaultSize: 160,
    params: [
      {
        key: 'planes',
        label: 'Planes',
        min: 1,
        max: 5,
        step: 1,
        rest: 3,
        hover: 3,
        structural: true,
      },
      {
        key: 'divisions',
        label: 'Divisions',
        min: 1,
        max: 6,
        step: 1,
        rest: 2,
        hover: 2,
        structural: true,
      },
      { key: 'gap', label: 'Gap', min: 0, max: 40, step: 0.5, rest: 6, hover: 20 },
      { key: 'tilt', label: 'Tilt', min: 0, max: 1, step: 0.01, rest: 0.36, hover: 0.25 },
      { key: 'spin', label: 'Spin', min: -3.14, max: 3.14, step: 0.01, rest: 0, hover: 1.2 },
    ],
    build: (p) => {
      const half = 40
      const planes = Math.round(p.planes)
      const div = Math.round(p.divisions)
      const totalH = (planes - 1) * p.gap
      const proj = (u: number, v: number, z: number): Pt => {
        const [ru, rv] = rotate2(u, v, p.spin)
        const pp = isoProject(ru * half, rv * half, 0, p.tilt)
        return [pp[0], pp[1] + (z - totalH / 2)]
      }
      const E: Edge[] = []
      for (let pl = 0; pl < planes; pl++) {
        const z = pl * p.gap
        for (let i = 0; i <= div; i++) {
          const v = -1 + (2 * i) / div
          E.push([proj(-1, v, z), proj(1, v, z)])
        }
        for (let i = 0; i <= div; i++) {
          const u = -1 + (2 * i) / div
          E.push([proj(u, -1, z), proj(u, 1, z)])
        }
      }
      return edgesToPaths(E)
    },
  },
  {
    id: 'fourbox',
    label: 'Four-box twist — Ingest context',
    defaultStroke: 1.5,
    defaultGoo: 0.8,
    defaultSize: 160,
    params: [
      {
        key: 'boxes',
        label: 'Boxes',
        min: 2,
        max: 6,
        step: 1,
        rest: 4,
        hover: 4,
        structural: true,
      },
      { key: 'gap', label: 'Gap', min: 0, max: 20, step: 0.5, rest: 2.5, hover: 9 },
      { key: 'twist', label: 'Twist (deg)', min: 0, max: 90, step: 1, rest: 14, hover: 34 },
      { key: 'spin', label: 'Spin', min: -3.14, max: 3.14, step: 0.01, rest: 0, hover: 1.2 },
      { key: 'tilt', label: 'Tilt', min: 0, max: 1, step: 0.01, rest: 0.55, hover: 0.5 },
    ],
    build: (p) => {
      const boxes = Math.round(p.boxes)
      const twRad = (p.twist * Math.PI) / 180
      const totalH = (boxes - 1) * p.gap
      const E: Edge[] = []
      for (let i = 0; i < boxes; i++) {
        const zc = i * p.gap - totalH / 2
        const rot = p.spin * i * 0.5 + i * twRad
        E.push(...cubeEdges(1.0, p.tilt, rot, 0.4, zc))
      }
      return edgesToPaths(E)
    },
  },
  {
    id: 'nestedcube',
    label: 'Nested cube — Monitor',
    defaultStroke: 1.5,
    defaultGoo: 0.8,
    defaultSize: 160,
    params: [
      {
        key: 'tilt',
        label: 'Tilt',
        min: 0,
        max: 1,
        step: 0.01,
        rest: 0.5,
        hover: 0.5,
        structural: true,
      },
      { key: 'inner', label: 'Inner scale', min: 0.1, max: 1, step: 0.01, rest: 0.42, hover: 0.9 },
      { key: 'spin', label: 'Spin', min: -3.14, max: 3.14, step: 0.01, rest: 0, hover: 1.2 },
    ],
    build: (p) => {
      const E: Edge[] = [
        ...cubeEdges(1.0, p.tilt, 0, 1, 0),
        ...cubeEdges(p.inner, p.tilt, p.spin, 1, 0),
      ]
      return edgesToPaths(E)
    },
  },
  {
    id: 'lissajous',
    label: 'Lissajous — Build',
    defaultStroke: 3,
    defaultGoo: 1.5,
    defaultSize: 160,
    params: [
      { key: 'a', label: 'Freq A', min: 1, max: 7, step: 1, rest: 3, hover: 3, structural: true },
      { key: 'b', label: 'Freq B', min: 1, max: 7, step: 1, rest: 2, hover: 2, structural: true },
      {
        key: 'amp',
        label: 'Amplitude',
        min: 10,
        max: 48,
        step: 1,
        rest: 40,
        hover: 40,
        structural: true,
      },
      { key: 'phase', label: 'Phase', min: 0, max: 6.28, step: 0.01, rest: 1.5708, hover: 1.9708 },
    ],
    build: (p) => {
      const fn = (t: number): Pt => [
        50 + p.amp * Math.sin(p.a * t + p.phase),
        50 + p.amp * Math.sin(p.b * t),
      ]
      return toPath(normalizeReach(sampleClosed(fn)))
    },
  },
]

interface Pair {
  rest: number
  hover: number
}

interface GradientConfig {
  from: string
  to: string
  cx: Pair
  cy: Pair
  r: Pair
}

interface MarkConfig {
  params: Record<string, Pair>
  stroke: Pair
  goo: Pair
  gradient: GradientConfig
  size: number
}

function initConfigs(): Record<string, MarkConfig> {
  const out: Record<string, MarkConfig> = {}
  for (const m of MARKS) {
    const params: Record<string, Pair> = {}
    for (const p of m.params) params[p.key] = { rest: p.rest, hover: p.hover }
    out[m.id] = {
      params,
      stroke: { rest: m.defaultStroke, hover: m.defaultStroke },
      goo: { rest: m.defaultGoo, hover: m.defaultGoo },
      gradient: {
        from: '#2C2C2C',
        to: '#5F5F5F',
        cx: { rest: 50, hover: 50 },
        cy: { rest: 50, hover: 50 },
        r: { rest: 44, hover: 44 },
      },
      size: m.defaultSize,
    }
  }
  return out
}

const panel = 'rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4'
const sectionLabel = 'text-[12px] text-[var(--text-muted)]'

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className='flex items-center gap-3'>
      <span className='w-[104px] flex-shrink-0 text-[12px] text-[var(--text-body)]'>{label}</span>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className='h-1 flex-1 cursor-pointer accent-[var(--text-primary)]'
      />
      <span className='w-[48px] flex-shrink-0 text-right font-mono text-[11px] text-[var(--text-muted)]'>
        {value.toFixed(step < 1 ? 2 : 0)}
      </span>
    </label>
  )
}

function PairRow({
  label,
  def,
  pair,
  onChange,
}: {
  label: string
  def: { min: number; max: number; step: number }
  pair: Pair
  onChange: (side: 'rest' | 'hover', v: number) => void
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <Slider
        label={`${label} ·before`}
        value={pair.rest}
        min={def.min}
        max={def.max}
        step={def.step}
        onChange={(v) => onChange('rest', v)}
      />
      <Slider
        label={`${label} ·after`}
        value={pair.hover}
        min={def.min}
        max={def.max}
        step={def.step}
        onChange={(v) => onChange('hover', v)}
      />
    </div>
  )
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className='flex items-center gap-3'>
      <span className='w-[104px] flex-shrink-0 text-[12px] text-[var(--text-body)]'>{label}</span>
      <input
        type='color'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='h-7 w-10 flex-shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent'
      />
      <span className='font-mono text-[11px] text-[var(--text-muted)]'>{value}</span>
    </label>
  )
}

export function MarksLab() {
  const [configs, setConfigs] = useState<Record<string, MarkConfig>>(initConfigs)
  const [markId, setMarkId] = useState(MARKS[0].id)
  const [amt, setAmt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number | null>(null)

  const mark = MARKS.find((m) => m.id === markId) as LabMark
  const cfg = configs[markId]

  useEffect(() => {
    if (!playing) return
    const start = performance.now()
    const loop = () => {
      const t = (performance.now() - start) / 1000
      setAmt((1 - Math.cos(t * 1.4)) / 2)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [playing])

  const resolved = useMemo(() => {
    const p: Record<string, number> = {}
    for (const def of mark.params) {
      const c = cfg.params[def.key]
      p[def.key] = lerp(c.rest, c.hover, amt)
    }
    return p
  }, [mark, cfg, amt])

  const strokeNow = lerp(cfg.stroke.rest, cfg.stroke.hover, amt)
  const gooNow = lerp(cfg.goo.rest, cfg.goo.hover, amt)
  const gradCx = lerp(cfg.gradient.cx.rest, cfg.gradient.cx.hover, amt)
  const gradCy = lerp(cfg.gradient.cy.rest, cfg.gradient.cy.hover, amt)
  const gradR = lerp(cfg.gradient.r.rest, cfg.gradient.r.hover, amt)
  const d = mark.build(resolved)

  const setPair = (
    group: 'params' | 'stroke' | 'goo',
    key: string,
    side: 'rest' | 'hover',
    v: number
  ) =>
    setConfigs((prev) => {
      const next = structuredClone(prev)
      const target = group === 'params' ? next[markId].params[key] : next[markId][group]
      target[side] = v
      return next
    })

  const setSize = (v: number) =>
    setConfigs((prev) => {
      const next = structuredClone(prev)
      next[markId].size = v
      return next
    })

  const setGradColor = (which: 'from' | 'to', v: string) =>
    setConfigs((prev) => {
      const next = structuredClone(prev)
      next[markId].gradient[which] = v
      return next
    })

  const setGradPair = (key: 'cx' | 'cy' | 'r', side: 'rest' | 'hover', v: number) =>
    setConfigs((prev) => {
      const next = structuredClone(prev)
      next[markId].gradient[key][side] = v
      return next
    })

  const readout = useMemo(() => {
    const restGeo: Record<string, number> = {}
    const hoverGeo: Record<string, number> = {}
    for (const def of mark.params) {
      const c = cfg.params[def.key]
      restGeo[def.key] = c.rest
      hoverGeo[def.key] = c.hover
    }
    const g = cfg.gradient
    return JSON.stringify(
      {
        size: cfg.size,
        gradient: { from: g.from, to: g.to },
        REST: {
          ...restGeo,
          stroke: cfg.stroke.rest,
          gooFusion: cfg.goo.rest,
          gradCx: g.cx.rest,
          gradCy: g.cy.rest,
          gradR: g.r.rest,
        },
        HOVER: {
          ...hoverGeo,
          stroke: cfg.stroke.hover,
          gooFusion: cfg.goo.hover,
          gradCx: g.cx.hover,
          gradCy: g.cy.hover,
          gradR: g.r.hover,
        },
      },
      null,
      2
    )
  }, [mark, cfg])

  return (
    <div className='light min-h-screen bg-[var(--bg)] px-8 py-10 text-[var(--text-primary)]'>
      <div className='mx-auto flex max-w-[1100px] flex-col gap-6'>
        <div>
          <h1 className='font-medium text-[20px]'>Brand mark lab</h1>
          <p className='mt-1 text-[13px] text-[var(--text-muted)]'>
            Tune each mark's before-hover and after-hover state — geometry, stroke, and goo fusion.
            Scrub or play the transition, then copy the readout into the component constants.
          </p>
        </div>

        <div className='flex flex-wrap gap-2'>
          {MARKS.map((m) => (
            <button
              key={m.id}
              type='button'
              onClick={() => {
                setMarkId(m.id)
                setAmt(0)
                setPlaying(false)
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                m.id === markId
                  ? 'bg-[var(--text-primary)] text-[var(--bg)]'
                  : 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-body)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className='grid grid-cols-[1fr_380px] gap-6'>
          <div className='flex flex-col gap-4'>
            <div className='flex min-h-[360px] items-center justify-center rounded-lg border border-[var(--border-1)] bg-[#ffffff]'>
              <svg
                viewBox='0 0 100 100'
                width={cfg.size}
                height={cfg.size}
                fill='none'
                style={{ display: 'block' }}
              >
                <defs>
                  <radialGradient
                    id='lab-grad'
                    gradientUnits='userSpaceOnUse'
                    cx={gradCx}
                    cy={gradCy}
                    r={gradR}
                  >
                    <stop stopColor={cfg.gradient.from} />
                    <stop offset='1' stopColor={cfg.gradient.to} />
                  </radialGradient>
                  <filter id='lab-goo' x='-25%' y='-25%' width='150%' height='150%'>
                    <feGaussianBlur in='SourceGraphic' stdDeviation={gooNow} result='b' />
                    <feColorMatrix
                      in='b'
                      type='matrix'
                      values='1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9'
                    />
                  </filter>
                </defs>
                <g
                  filter='url(#lab-goo)'
                  stroke='url(#lab-grad)'
                  strokeWidth={strokeNow}
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  fill='none'
                >
                  <path d={d} />
                </g>
              </svg>
            </div>

            <div className={`${panel} flex flex-col gap-3`}>
              <div className='flex items-center gap-3'>
                <button
                  type='button'
                  onClick={() => setPlaying((v) => !v)}
                  className='rounded-md bg-[var(--text-primary)] px-3 py-1.5 text-[13px] text-[var(--bg)]'
                >
                  {playing ? 'Pause' : 'Play hover'}
                </button>
                <Slider
                  label='Hover amt'
                  value={amt}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => {
                    setPlaying(false)
                    setAmt(v)
                  }}
                />
              </div>
              <Slider
                label='Size'
                value={cfg.size}
                min={60}
                max={300}
                step={2}
                onChange={setSize}
              />
            </div>
          </div>

          <div className='flex flex-col gap-4'>
            <div className={`${panel} flex flex-col gap-3`}>
              <div className={sectionLabel}>Geometry (before → after hover)</div>
              {mark.params.map((def) => (
                <PairRow
                  key={def.key}
                  label={def.label}
                  def={def}
                  pair={cfg.params[def.key]}
                  onChange={(side, v) => setPair('params', def.key, side, v)}
                />
              ))}
            </div>

            <div className={`${panel} flex flex-col gap-3`}>
              <div className={sectionLabel}>Style (before → after hover)</div>
              <PairRow
                label='Stroke'
                def={{ min: 0.5, max: 6, step: 0.1 }}
                pair={cfg.stroke}
                onChange={(side, v) => setPair('stroke', 'stroke', side, v)}
              />
              <PairRow
                label='Goo fusion'
                def={{ min: 0, max: 3, step: 0.1 }}
                pair={cfg.goo}
                onChange={(side, v) => setPair('goo', 'goo', side, v)}
              />
            </div>

            <div className={`${panel} flex flex-col gap-3`}>
              <div className={sectionLabel}>
                Gradient — radial stops + position (moves on hover)
              </div>
              <ColorRow
                label='From'
                value={cfg.gradient.from}
                onChange={(v) => setGradColor('from', v)}
              />
              <ColorRow
                label='To'
                value={cfg.gradient.to}
                onChange={(v) => setGradColor('to', v)}
              />
              <PairRow
                label='Center X'
                def={{ min: 0, max: 100, step: 1 }}
                pair={cfg.gradient.cx}
                onChange={(side, v) => setGradPair('cx', side, v)}
              />
              <PairRow
                label='Center Y'
                def={{ min: 0, max: 100, step: 1 }}
                pair={cfg.gradient.cy}
                onChange={(side, v) => setGradPair('cy', side, v)}
              />
              <PairRow
                label='Radius'
                def={{ min: 6, max: 90, step: 1 }}
                pair={cfg.gradient.r}
                onChange={(side, v) => setGradPair('r', side, v)}
              />
            </div>

            <div className={`${panel} flex flex-col gap-2`}>
              <div className={sectionLabel}>Readout</div>
              <pre className='max-h-[240px] overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-1)] p-3 font-mono text-[11px] text-[var(--text-body)]'>
                {readout}
              </pre>
              <button
                type='button'
                onClick={() => navigator.clipboard?.writeText(readout)}
                className='self-start rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-[12px] text-[var(--text-body)]'
              >
                Copy JSON
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
