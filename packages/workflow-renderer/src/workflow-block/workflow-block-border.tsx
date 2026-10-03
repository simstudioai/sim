import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
  type WorkflowCardSide,
  type WorkflowConnectionSide,
} from '@sim/workflow-types/workflow'
import { BLOCK_DIMENSIONS } from '../dimensions'

/**
 * Resolves a point on the card's top or bottom edge into the connection half
 * it belongs to. Presentation only — it picks which side the swell grows from
 * and is deliberately not encoded into any persisted handle id.
 */
const getConnectionSideForPoint = (pointerX: number, cardWidth: number): WorkflowConnectionSide => {
  if (!Number.isFinite(pointerX) || !Number.isFinite(cardWidth) || cardWidth <= 0) return 'right'
  return pointerX < cardWidth / 2 ? 'left' : 'right'
}

const BORDER_PADDING_PX = 36
const SAMPLE_SPACING_PX = 1
/** Smallest arc-length step used to cross a floating-point segment seam. */
const PERIMETER_CURSOR_EPSILON_PX = 0.0001
/**
 * How far every connection knob stands off the card edge. Edges anchor exactly
 * this far out (the `-7px` handle outsets in workflow-block-view), so the two
 * must stay equal or the line detaches from the knob.
 */
export const CONNECTION_KNOB_PEAK_PX = 7
const CURSOR_PEAK_PX = CONNECTION_KNOB_PEAK_PX
const PORT_FILL_STROKE_WIDTH_PX = 24
/** The silhouette's outline. Half of it sits outside the filled shape. */
const SILHOUETTE_STROKE_WIDTH_PX = 1.5
/**
 * Displacement below this reads as flat, so `bulgeContribution` zeroes it. The
 * painted knob has to stop at the same place or the colour carries on down the
 * straight wall as a thin leg past the shape it is filling.
 */
const BULGE_VISIBLE_THRESHOLD_PX = 0.25
export const CURSOR_SWELL_LENGTH_PX = 38
/** Shared swell proportions — plateau and shoulder as fractions of tab length. */
const CONNECTION_PLATEAU_RATIO = 0.4
const CONNECTION_SHOULDER_RATIO = 0.3
/** Arc length the cursor swell occupies either side of its centre. */
const CURSOR_HALF_FOOTPRINT_PX =
  (CURSOR_SWELL_LENGTH_PX * CONNECTION_PLATEAU_RATIO) / 2 +
  CURSOR_SWELL_LENGTH_PX * CONNECTION_SHOULDER_RATIO
/**
 * How far edge hover reaches into a card. Keeping this narrow preserves the
 * title and body as an unambiguous grab surface while leaving the border easy
 * to acquire.
 */
const CURSOR_EDGE_INSET_PX = 12
/**
 * Outside the card, activation matches the temporary handle's physical reach
 * so the swell, cursor, and connection-start area stay in agreement.
 */
const CURSOR_EDGE_OUTSET_PX = 20
const CURSOR_TRACKING_MARGIN_PX = 36
const MAGNETIZE_DISTANCE_PX = 30
/** Base peak of the action-menu tab, scaled by its own amplitude. */
const ACTION_MENU_PEAK_PX = 4
/**
 * Action-menu swell proportions, calibrated on the canonical bar (164px /
 * Condition & 5-icon cards). Shoulders stay a fixed 36px so every card shares
 * the same taper angle, top radius, and concave fillet. The taper budget is
 * also a fixed 56px (28px/side) subtracted from the measured bar width — not a
 * width ratio — so shorter bars (Start, 4 icons) keep the same flat-edge→icon
 * inset as Condition. Ratio-scaling that 56px with width pulled Start’s flat
 * edge outward relative to the icons and read as extra dead gray on the left.
 */
const ACTION_MENU_TAPER_PX = 56
const ACTION_MENU_SHOULDER_PX = 36
const ACTION_MENU_CURVE_MID_X = 0.6402
const ACTION_MENU_CURVE_MID_Y = 0.6995
const ACTION_MENU_CURVE_TOP_X1 = 0.1998
const ACTION_MENU_CURVE_TOP_X2 = 0.1978
const ACTION_MENU_CURVE_BOTTOM_X1 = 0.8057
const ACTION_MENU_CURVE_BOTTOM_Y1 = 0.9606
const ACTION_MENU_CURVE_BOTTOM_X2 = 0.9257
const ACTION_MENU_CURVE_BOTTOM_Y2 = 0.9967
const SPRING_STIFFNESS = 300
const SPRING_DAMPING = 32
const ACTION_MENU_SPRING_STIFFNESS = 480
const ACTION_MENU_SPRING_DAMPING = 38
/**
 * Must stay above the action row's own height as a fraction of the fully-open
 * swell (24px of buttons in a 28px swell = 0.857). Below that the row is
 * revealed while the swell is still shorter than it is, and because the row
 * clips to the swell height the icons collide with the card's top edge for the
 * remainder of the opening spring.
 */
const ACTION_MENU_CONTENT_READY_THRESHOLD = 0.9
/** Quick deswell when the swell hands off to a hovered knob. */
const CURSOR_SNAP_SPRING_STIFFNESS = 560
const CURSOR_SNAP_SPRING_DAMPING = 42
const MAX_PORT_AMPLITUDE = 7
const MAX_SILHOUETTE_OUTSET_PX = ACTION_MENU_PEAK_PX * MAX_PORT_AMPLITUDE
/**
 * Amplitude below which the swell may cross a coloured knob's zone. At 0.2 the
 * bump is under 1.5px — effectively gone — so the swell re-emerges on the far
 * side already growing instead of waiting to die completely and restart from
 * zero, which read as a long blank gap after passing a knob.
 */
const CURSOR_CROSSING_AMPLITUDE = 0.2
const MAX_FRAME_DELTA_SECONDS = 1 / 30

/**
 * Returns a monotonic, capped animation step. Synchronous repaints can occur
 * between requested frames, so a later callback may carry an older timestamp.
 */
export const getWorkflowBorderFrameDeltaSeconds = (
  timestamp: number,
  previousTimestamp: number
) => {
  if (!Number.isFinite(timestamp)) return 0
  if (previousTimestamp === 0) return 1 / 60
  const elapsed = (timestamp - previousTimestamp) / 1000
  if (!Number.isFinite(elapsed)) return 0
  return Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, elapsed))
}

export const isActionMenuSwellReady = (target: number, value: number) =>
  target === 1 && value >= ACTION_MENU_CONTENT_READY_THRESHOLD

export interface WorkflowBorderPort {
  id: string
  side: WorkflowCardSide
  position: number | 'center' | { fromEnd: number }
  plateau: number
  color?: string
  restAmplitude?: number
  hoverAmplitude?: number
  magnetizable?: boolean
  revealOnCardHover?: boolean
}

export interface WorkflowBorderCursorHandle {
  side: WorkflowConnectionSide
  edgeSide: WorkflowCardSide
  x: number
  y: number
}

interface WorkflowBlockBorderProps {
  nodeId?: string
  getConnectionNodeId?: () => string | null
  ports: WorkflowBorderPort[]
  /** Enables the transient pointer-following swell used to start or target connections. */
  cursorSwellEnabled?: boolean
  /** Limits pointer-following swells to specific card sides. */
  cursorSwellSides?: readonly WorkflowCardSide[]
  /**
   * Whether hovering this card may raise a swell to drag a connection OUT of
   * it. False for cards that mount no source handle, so the swell never
   * promises an edge the card cannot start.
   */
  canStartConnection?: boolean
  /**
   * Whether this card may raise a swell while a connection dragged from
   * another card passes over it. False for cards that mount no target handle,
   * so the swell never promises a drop the card cannot accept.
   */
  canReceiveConnection?: boolean
  radius?: number
  hasRing: boolean
  ringStyles: string
  /** Paints the unified silhouette with the canonical selected-state color. */
  isSelected?: boolean
  /** Overrides the selected silhouette while preserving the canonical idle and ring colors. */
  selectedSilhouetteColor?: string
  /** Overrides the resolved silhouette without changing selected or ring state. */
  silhouetteColorOverride?: string
  /** Fills the card body without changing its silhouette or border color. */
  bodyFill?: string
  /** Explicit layout width for fixed-size hosts; omit to measure the host. */
  width?: number
  /** First-frame height used while an observed host has not reported its size yet. */
  initialHeight?: number
  /**
   * Card height in layout px. Must match what the card actually renders — the
   * silhouette is drawn from it, so an over-estimate paints a card taller than
   * its content. Omit to measure the host instead (read-only surfaces).
   */
  height?: number
  onCursorHandleChange?: (handle: WorkflowBorderCursorHandle | null) => void
  onActionMenuReadyChange?: (ready: boolean) => void
}

interface PerimeterPoint {
  s: number
  x: number
  y: number
  nx: number
  ny: number
  tx: number
  ty: number
}

const getPerimeterPointSide = (point: Pick<PerimeterPoint, 'nx' | 'ny'>): WorkflowCardSide =>
  Math.abs(point.nx) > Math.abs(point.ny)
    ? point.nx < 0
      ? 'left'
      : 'right'
    : point.ny < 0
      ? 'top'
      : 'bottom'

interface PerimeterSegment {
  kind: 'line' | 'arc'
  startS: number
  length: number
  radius?: number
  pointAt: (distance: number) => Omit<PerimeterPoint, 's'>
}

interface PerimeterGeometry {
  samples: PerimeterPoint[]
  segments: PerimeterSegment[]
  length: number
}

interface PortSample extends WorkflowBorderPort {
  s: number
}

interface SpringValue {
  value: number
  velocity: number
  target: number
}

interface BulgeFeature {
  center: number
  plateau: number
  peak: number
  shoulder: number
  falloff?: 'action-menu'
}

interface ActiveInterval {
  start: number
  end: number
}

const isPrimaryConnectionPort = (portId: string) =>
  portId === WORKFLOW_SOURCE_HANDLE_ID || portId === WORKFLOW_TARGET_HANDLE_ID

/**
 * Every connection knob is the same swell, scaled by its own tab length —
 * branch rows and the error output are the main port's shape at ~63%, not a
 * different nub. The primary ports measure against the cursor footprint so a
 * resting knob and the hover swell are interchangeable silhouettes.
 */
const getPortBulgeProfile = (port: WorkflowBorderPort) => {
  if (port.id === 'action-menu') {
    return {
      plateau: Math.max(0, port.plateau - ACTION_MENU_TAPER_PX),
      shoulder: ACTION_MENU_SHOULDER_PX,
    }
  }
  const footprint = isPrimaryConnectionPort(port.id) ? CURSOR_SWELL_LENGTH_PX : port.plateau
  return {
    plateau: footprint * CONNECTION_PLATEAU_RATIO,
    shoulder: footprint * CONNECTION_SHOULDER_RATIO,
  }
}

/**
 * Every connection knob protrudes the same distance — only its width scales.
 * Edges anchor a fixed `CONNECTION_KNOB_PEAK_PX` outside the card, so a knob
 * that peaked any lower would leave the line floating short of it.
 *
 * The action menu is not a connection knob: nothing anchors to it, and its own
 * amplitude multiplies this base, so it keeps the shallower peak that sets the
 * tab's height against the card.
 */
const getPortPeak = (port: WorkflowBorderPort) =>
  port.id === 'action-menu' ? ACTION_MENU_PEAK_PX : CONNECTION_KNOB_PEAK_PX

const smootherstep = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value))
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10)
}

const cubicBezierCoordinate = (
  t: number,
  start: number,
  firstControl: number,
  secondControl: number,
  end: number
) => {
  const inverse = 1 - t
  return (
    inverse * inverse * inverse * start +
    3 * inverse * inverse * t * firstControl +
    3 * inverse * t * t * secondControl +
    t * t * t * end
  )
}

const actionMenuCurveCoordinate = (parameter: number, axis: 'x' | 'y') => {
  if (parameter <= 1) {
    return axis === 'x'
      ? cubicBezierCoordinate(
          parameter,
          0,
          ACTION_MENU_CURVE_TOP_X1,
          ACTION_MENU_CURVE_TOP_X2,
          ACTION_MENU_CURVE_MID_X
        )
      : cubicBezierCoordinate(parameter, 0, 0, 0, ACTION_MENU_CURVE_MID_Y)
  }
  const t = parameter - 1
  return axis === 'x'
    ? cubicBezierCoordinate(
        t,
        ACTION_MENU_CURVE_MID_X,
        ACTION_MENU_CURVE_BOTTOM_X1,
        ACTION_MENU_CURVE_BOTTOM_X2,
        1
      )
    : cubicBezierCoordinate(
        t,
        ACTION_MENU_CURVE_MID_Y,
        ACTION_MENU_CURVE_BOTTOM_Y1,
        ACTION_MENU_CURVE_BOTTOM_Y2,
        1
      )
}

const actionMenuFalloff = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value))
  let lower = 0
  let upper = 2
  for (let index = 0; index < 12; index++) {
    const midpoint = (lower + upper) / 2
    const x = actionMenuCurveCoordinate(midpoint, 'x')
    if (x < clamped) lower = midpoint
    else upper = midpoint
  }
  return actionMenuCurveCoordinate((lower + upper) / 2, 'y')
}

const modulo = (value: number, length: number) => ((value % length) + length) % length

const shortestArcDelta = (from: number, to: number, length: number) => {
  const direct = modulo(to - from, length)
  return direct > length / 2 ? direct - length : direct
}

const arcDistance = (a: number, b: number, length: number) =>
  Math.abs(shortestArcDelta(a, b, length))

const springStep = (
  spring: SpringValue,
  deltaSeconds: number,
  stiffness = SPRING_STIFFNESS,
  damping = SPRING_DAMPING,
  bounds?: { min: number; max: number }
) => {
  const minimum = bounds?.min ?? Number.NEGATIVE_INFINITY
  const maximum = bounds?.max ?? Number.POSITIVE_INFINITY
  const target = Number.isFinite(spring.target)
    ? Math.min(maximum, Math.max(minimum, spring.target))
    : Math.min(maximum, Math.max(minimum, 0))
  spring.target = target

  if (!Number.isFinite(spring.value) || !Number.isFinite(spring.velocity)) {
    spring.value = target
    spring.velocity = 0
    return
  }

  const safeDelta = Number.isFinite(deltaSeconds)
    ? Math.min(MAX_FRAME_DELTA_SECONDS, Math.max(0, deltaSeconds))
    : 0
  const force = stiffness * (target - spring.value) - damping * spring.velocity
  const nextVelocity = spring.velocity + force * safeDelta
  const nextValue = spring.value + nextVelocity * safeDelta
  if (!Number.isFinite(nextValue) || !Number.isFinite(nextVelocity)) {
    spring.value = target
    spring.velocity = 0
    return
  }

  spring.value = Math.min(maximum, Math.max(minimum, nextValue))
  spring.velocity =
    (spring.value === minimum && nextVelocity < 0) || (spring.value === maximum && nextVelocity > 0)
      ? 0
      : nextVelocity
}

const springAtRest = (spring: SpringValue) =>
  Math.abs(spring.target - spring.value) < 0.001 && Math.abs(spring.velocity) < 0.001

const bulgeContribution = (
  distance: number,
  plateau: number,
  peak: number,
  shoulderOverride?: number,
  falloff?: BulgeFeature['falloff']
) => {
  const plateauHalf = plateau / 2
  if (distance <= plateauHalf) return peak
  const shoulder = shoulderOverride ?? Math.max(8, plateau * 0.75)
  const footprintHalf = plateauHalf + shoulder
  if (distance >= footprintHalf) return 0
  const progress = (distance - plateauHalf) / shoulder
  const easedProgress =
    falloff === 'action-menu' ? actionMenuFalloff(progress) : smootherstep(progress)
  const contribution = peak * (1 - easedProgress)
  return contribution < BULGE_VISIBLE_THRESHOLD_PX ? 0 : contribution
}

const buildRoundedRectPerimeter = (width: number, height: number, requestedRadius: number) => {
  const radius = Math.min(requestedRadius, width / 2, height / 2)
  const horizontal = Math.max(0, width - radius * 2)
  const vertical = Math.max(0, height - radius * 2)
  const quarterArc = (Math.PI * radius) / 2
  const segments: PerimeterSegment[] = []
  let s = 0

  const addLine = (
    length: number,
    startX: number,
    startY: number,
    tx: number,
    ty: number,
    nx: number,
    ny: number
  ) => {
    segments.push({
      kind: 'line',
      startS: s,
      length,
      pointAt: (distance) => ({
        x: startX + tx * distance,
        y: startY + ty * distance,
        nx,
        ny,
        tx,
        ty,
      }),
    })
    s += length
  }

  const addArc = (centerX: number, centerY: number, startAngle: number) => {
    segments.push({
      kind: 'arc',
      startS: s,
      length: quarterArc,
      radius,
      pointAt: (distance) => {
        const angle = startAngle + distance / radius
        return {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          nx: Math.cos(angle),
          ny: Math.sin(angle),
          tx: -Math.sin(angle),
          ty: Math.cos(angle),
        }
      },
    })
    s += quarterArc
  }

  addLine(horizontal, radius, 0, 1, 0, 0, -1)
  addArc(width - radius, radius, -Math.PI / 2)
  addLine(vertical, width, radius, 0, 1, 1, 0)
  addArc(width - radius, height - radius, 0)
  addLine(horizontal, width - radius, height, -1, 0, 0, 1)
  addArc(radius, height - radius, Math.PI / 2)
  addLine(vertical, 0, height - radius, 0, -1, -1, 0)
  addArc(radius, radius, Math.PI)

  const samples: PerimeterPoint[] = []
  for (const segment of segments) {
    const count = Math.max(1, Math.ceil(segment.length / SAMPLE_SPACING_PX))
    for (let index = 0; index < count; index++) {
      const distance = (index / count) * segment.length
      samples.push({ s: segment.startS + distance, ...segment.pointAt(distance) })
    }
  }
  return { samples, segments, length: s }
}

const closestSample = (
  samples: PerimeterPoint[],
  x: number,
  y: number,
  predicate?: (sample: PerimeterPoint) => boolean
) => {
  let closest = samples[0]
  let closestDistance = Number.POSITIVE_INFINITY
  for (const sample of samples) {
    if (predicate && !predicate(sample)) continue
    const distance = (sample.x - x) ** 2 + (sample.y - y) ** 2
    if (distance < closestDistance) {
      closest = sample
      closestDistance = distance
    }
  }
  return { sample: closest, distance: Math.sqrt(closestDistance) }
}

const resolvePortSamples = (
  ports: WorkflowBorderPort[],
  samples: PerimeterPoint[],
  width: number,
  height: number
): PortSample[] =>
  ports.map((port) => {
    const axisLength = port.side === 'left' || port.side === 'right' ? height : width
    const coordinate =
      port.position === 'center'
        ? axisLength / 2
        : typeof port.position === 'number'
          ? port.position
          : axisLength - port.position.fromEnd
    const target =
      port.side === 'left'
        ? { x: 0, y: coordinate }
        : port.side === 'right'
          ? { x: width, y: coordinate }
          : port.side === 'top'
            ? { x: coordinate, y: 0 }
            : { x: coordinate, y: height }
    const normal =
      port.side === 'left'
        ? { nx: -1, ny: 0 }
        : port.side === 'right'
          ? { nx: 1, ny: 0 }
          : port.side === 'top'
            ? { nx: 0, ny: -1 }
            : { nx: 0, ny: 1 }
    const { sample } = closestSample(
      samples,
      target.x,
      target.y,
      (candidate) => candidate.nx === normal.nx && candidate.ny === normal.ny
    )
    return { ...port, s: sample.s }
  })

const pointAtArcLength = (geometry: PerimeterGeometry, arcLength: number) => {
  const normalized = modulo(arcLength, geometry.length)
  const segment =
    geometry.segments.find(
      (candidate) =>
        normalized >= candidate.startS && normalized < candidate.startS + candidate.length
    ) ?? geometry.segments[geometry.segments.length - 1]
  return {
    segment,
    local: normalized - segment.startS,
    point: segment.pointAt(normalized - segment.startS),
  }
}

const buildActiveIntervals = (features: BulgeFeature[], perimeterLength: number) => {
  const split: ActiveInterval[] = []
  for (const feature of features) {
    if (
      !Number.isFinite(feature.center) ||
      !Number.isFinite(feature.plateau) ||
      !Number.isFinite(feature.peak) ||
      !Number.isFinite(feature.shoulder) ||
      feature.peak < 0.25
    ) {
      continue
    }
    const half = feature.plateau / 2 + feature.shoulder + 4
    const start = feature.center - half
    const end = feature.center + half
    if (start < 0) {
      split.push({ start: 0, end })
      split.push({ start: perimeterLength + start, end: perimeterLength })
    } else if (end > perimeterLength) {
      split.push({ start, end: perimeterLength })
      split.push({ start: 0, end: end - perimeterLength })
    } else {
      split.push({ start, end })
    }
  }
  split.sort((a, b) => a.start - b.start)
  const merged: ActiveInterval[] = []
  for (const interval of split) {
    const previous = merged[merged.length - 1]
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

const findQuietStart = (intervals: ActiveInterval[], perimeterLength: number) => {
  if (intervals.length === 0) return 0
  let largestGap = -1
  let start = 0
  for (let index = 0; index < intervals.length; index++) {
    const current = intervals[index]
    const next = intervals[(index + 1) % intervals.length]
    const nextStart = index === intervals.length - 1 ? next.start + perimeterLength : next.start
    const gap = nextStart - current.end
    if (gap > largestGap) {
      largestGap = gap
      start = modulo(current.end + gap / 2, perimeterLength)
    }
  }
  return largestGap > 0 ? start : 0
}

/** Flat run resampled either side of a bulge, so its tail rejoins the edge. */
const BULGE_INTERVAL_SLACK_PX = 4

/**
 * How far either side of a bulge's centre the outline is resampled — wider than
 * the bulge itself, so the curve has flat perimeter to settle onto. It also
 * fixes the sample grid a knob has to land on, which is why `visibleBulgeHalf`
 * measures against it.
 */
const bulgeIntervalHalf = (plateau: number, shoulder: number) =>
  plateau / 2 + shoulder + BULGE_INTERVAL_SLACK_PX

const relativeIntervals = (features: BulgeFeature[], startS: number, perimeterLength: number) => {
  const intervals = features
    .filter(
      (feature) =>
        Number.isFinite(feature.center) &&
        Number.isFinite(feature.plateau) &&
        Number.isFinite(feature.peak) &&
        Number.isFinite(feature.shoulder) &&
        feature.peak >= 0.25
    )
    .map((feature) => {
      const center = modulo(feature.center - startS, perimeterLength)
      const half = bulgeIntervalHalf(feature.plateau, feature.shoulder)
      return { start: center - half, end: center + half }
    })
    .filter((interval) => interval.end > 0 && interval.start < perimeterLength)
    .map((interval) => ({
      start: Math.max(0, interval.start),
      end: Math.min(perimeterLength, interval.end),
    }))
    .sort((a, b) => a.start - b.start)
  const merged: ActiveInterval[] = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

const displacementAt = (
  s: number,
  features: BulgeFeature[],
  perimeterLength: number,
  maximum: number
) => {
  /*
   * Union, not sum. Two overlapping bulges of the same height used to add
   * where they crossed, throwing up a spike near twice their peak — the
   * pointed mountain seen while the cursor swell slides into an existing
   * knob. Taking the max lets them merge into one shape at a constant height.
   */
  let displacement = 0
  for (const feature of features) {
    const contribution = bulgeContribution(
      arcDistance(s, feature.center, perimeterLength),
      feature.plateau,
      feature.peak,
      feature.shoulder,
      feature.falloff
    )
    if (Number.isFinite(contribution)) {
      displacement = Math.max(displacement, contribution)
    }
  }
  const safeMaximum = Number.isFinite(maximum)
    ? Math.min(MAX_SILHOUETTE_OUTSET_PX, Math.max(0, maximum))
    : 0
  const clamped = Math.min(displacement, safeMaximum)
  return clamped < BULGE_VISIBLE_THRESHOLD_PX ? 0 : clamped
}

/**
 * Where a bulge stops being drawn, by inverting the shoulder's easing at the
 * visibility threshold. The mathematical footprint (`plateau/2 + shoulder`)
 * overshoots this, because the tail is cut off once it flattens out.
 *
 * Pulled back to the silhouette's own sample points. `relativeIntervals`
 * resamples a bulge over `bulgeIntervalHalf` either side of its centre, split
 * into whole steps of about `SAMPLE_SPACING_PX` — so the crossing itself falls
 * between two of them. A knob cut there sits on a grid of its own and drifts
 * off the curve it is recolouring; see `buildSpanPath` for what that costs.
 * Retreating to the last sample at or beyond the crossing keeps the knob on
 * the silhouette's points whatever the bulge measures.
 */
const visibleBulgeHalf = (plateau: number, shoulder: number, peak: number) => {
  const plateauHalf = plateau / 2
  let crossing = plateauHalf
  if (peak > BULGE_VISIBLE_THRESHOLD_PX && shoulder > 0) {
    const target = 1 - BULGE_VISIBLE_THRESHOLD_PX / peak
    let low = 0
    let high = 1
    for (let step = 0; step < 24; step++) {
      const mid = (low + high) / 2
      if (smootherstep(mid) < target) low = mid
      else high = mid
    }
    crossing = plateauHalf + high * shoulder
  }
  const intervalHalf = bulgeIntervalHalf(plateau, shoulder)
  const step = (intervalHalf * 2) / Math.max(2, Math.ceil((intervalHalf * 2) / SAMPLE_SPACING_PX))
  return intervalHalf - Math.floor((intervalHalf - crossing) / step) * step
}

const appendExactInterval = (
  commands: string[],
  geometry: PerimeterGeometry,
  startS: number,
  from: number,
  to: number
) => {
  let cursor = from
  while (cursor < to - PERIMETER_CURSOR_EPSILON_PX) {
    const located = pointAtArcLength(geometry, startS + cursor)
    const available = located.segment.length - located.local
    const step = Math.min(to - cursor, available)
    if (!Number.isFinite(step) || step <= 0) break
    const nextCursor = cursor + step
    if (nextCursor <= cursor) {
      cursor = Math.min(to, cursor + PERIMETER_CURSOR_EPSILON_PX)
      continue
    }
    const end = located.segment.pointAt(located.local + step)
    commands.push(
      located.segment.kind === 'line'
        ? `L${end.x.toFixed(2)} ${end.y.toFixed(2)}`
        : `A${located.segment.radius} ${located.segment.radius} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
    )
    cursor = nextCursor
  }
}

const appendActiveInterval = (
  commands: string[],
  geometry: PerimeterGeometry,
  features: BulgeFeature[],
  maximum: number,
  startS: number,
  interval: ActiveInterval
) => {
  const length = interval.end - interval.start
  const count = Math.max(2, Math.ceil(length / SAMPLE_SPACING_PX))
  const points = Array.from({ length: count + 1 }, (_, index) => {
    const relative = interval.start + (index / count) * length
    const located = pointAtArcLength(geometry, startS + relative)
    const displacement = displacementAt(
      modulo(startS + relative, geometry.length),
      features,
      geometry.length,
      maximum
    )
    return {
      x: located.point.x + located.point.nx * displacement,
      y: located.point.y + located.point.ny * displacement,
      tx: located.point.tx,
      ty: located.point.ty,
    }
  })
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[Math.max(0, index - 1)]
    const current = points[index]
    const next = points[index + 1]
    const after = points[Math.min(points.length - 1, index + 2)]
    const chord = Math.hypot(next.x - current.x, next.y - current.y)
    const control1 =
      index === 0
        ? { x: current.x + (current.tx * chord) / 3, y: current.y + (current.ty * chord) / 3 }
        : {
            x: current.x + (next.x - previous.x) / 6,
            y: current.y + (next.y - previous.y) / 6,
          }
    const control2 =
      index === points.length - 2
        ? { x: next.x - (next.tx * chord) / 3, y: next.y - (next.ty * chord) / 3 }
        : {
            x: next.x - (after.x - current.x) / 6,
            y: next.y - (after.y - current.y) / 6,
          }
    commands.push(
      `C${control1.x.toFixed(2)} ${control1.y.toFixed(2)} ${control2.x.toFixed(2)} ${control2.y.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
    )
  }
  return points
}

/**
 * An open path over one span of the outline, sampled and displaced exactly like
 * the silhouette is.
 *
 * A coloured knob used to be a dash on the full perimeter, offset by the port's
 * resting arc position. But displacing the outline makes it *longer* than the
 * resting perimeter, and the extra length sits entirely at the bulges — so
 * normalising with `pathLength` spread that error evenly and the band drifted
 * off its own knob, leaving a crescent of base colour showing inside it. Giving
 * the knob its own path removes the arc-length bookkeeping altogether: the
 * colour is drawn on the same points the silhouette was.
 *
 * Sampled a step wide on each side and then trimmed back to the span. Every
 * control point is derived from the samples either side of it, so a span that
 * stopped at its own ends would have to clamp its first and last to the bare
 * perimeter tangent — and those two segments would bow differently from the
 * outline they are painted over. The knob was then still flat where the
 * silhouette had begun its descent, and the uncovered dark stroke read as a
 * barb off the shoulder tip. Borrowing a sample beyond each end gives every
 * emitted segment the neighbours the silhouette had, so the two agree command
 * for command.
 */
const buildSpanPath = (
  geometry: PerimeterGeometry,
  features: BulgeFeature[],
  maximum: number,
  fromS: number,
  toS: number
) => {
  const length = toS - fromS
  if (length <= 0) return ''
  const commands: string[] = []
  const points = appendActiveInterval(commands, geometry, features, maximum, fromS, {
    start: -SAMPLE_SPACING_PX,
    end: length + SAMPLE_SPACING_PX,
  })
  const origin = points[1]
  return [`M${origin.x.toFixed(2)} ${origin.y.toFixed(2)}`, ...commands.slice(1, -1)].join(' ')
}

const buildPiecewisePath = (
  geometry: PerimeterGeometry,
  features: BulgeFeature[],
  maximum: number
) => {
  const circularIntervals = buildActiveIntervals(features, geometry.length)
  const startS = findQuietStart(circularIntervals, geometry.length)
  const intervals = relativeIntervals(features, startS, geometry.length)
  const start = pointAtArcLength(geometry, startS).point
  const commands = [`M${start.x.toFixed(2)} ${start.y.toFixed(2)}`]
  let cursor = 0
  for (const interval of intervals) {
    appendExactInterval(commands, geometry, startS, cursor, interval.start)
    appendActiveInterval(commands, geometry, features, maximum, startS, interval)
    cursor = interval.end
  }
  appendExactInterval(commands, geometry, startS, cursor, geometry.length)
  commands.push('Z')
  return { d: commands.join(' '), startS }
}

const resolveRing = (ringStyles: string) => {
  const color = ringStyles.includes('--border-success')
    ? 'var(--border-success)'
    : ringStyles.includes('--text-secondary')
      ? 'var(--text-secondary)'
      : ringStyles.includes('--warning')
        ? 'var(--warning)'
        : ringStyles.includes('--text-error')
          ? 'var(--text-error)'
          : ringStyles.includes('--brand-accent')
            ? 'var(--brand-accent)'
            : 'var(--border-1)'
  return {
    color,
    width: ringStyles.includes('3.5px') ? 7 : 4.5,
    pulse: ringStyles.includes('animate-ring-pulse'),
    solid: ringStyles.includes('--text-secondary'),
  }
}

export function WorkflowBlockBorder({
  nodeId,
  getConnectionNodeId,
  ports,
  cursorSwellEnabled = true,
  cursorSwellSides,
  canStartConnection = true,
  canReceiveConnection = true,
  radius = 16,
  hasRing,
  ringStyles,
  isSelected = false,
  selectedSilhouetteColor,
  silhouetteColorOverride,
  bodyFill = 'var(--surface-2)',
  width,
  initialHeight,
  height,
  onCursorHandleChange,
  onActionMenuReadyChange,
}: WorkflowBlockBorderProps) {
  const clipId = `workflow-border-${useId().replaceAll(':', '')}`
  const svgRef = useRef<SVGSVGElement>(null)
  /*
   * A non-positive seed falls back rather than clamping: `useBlockProperties`
   * yields `block?.height ?? 0`, so a block missing from the store (diff
   * preview, embedded canvas) seeds 0, and a zero-height perimeter degenerates
   * — `radius` collapses to 0 and the card paints as a flat line. Any real
   * height is kept as-is, including one below MIN_PAINTED_HEIGHT: the subflow
   * Start pill is a deliberate 34px.
   *
   * `initialHeight` is the seed for a surface that sizes itself from its own
   * content rather than the store, which is how a note paints its outline
   * before the first measurement lands.
   */
  const [size, setSize] = useState({
    width: width ?? 250,
    height:
      height && height > 0
        ? height
        : initialHeight && initialHeight > 0
          ? initialHeight
          : BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT,
  })
  const [renderedPath, setRenderedPath] = useState<{
    d: string
    startS: number
    knobs: Array<{ id: string; color: string; d: string }>
    knobKey: string
    /** Open span over the action-menu swell, repainted over the knobs. */
    overlay: string
  }>({ d: '', startS: 0, knobs: [], knobKey: '', overlay: '' })
  /**
   * Render-visible copy of the resolved ports and perimeter length. The
   * animation loop reads geometry from `geometryRef`, but the colored port
   * segments are painted during render — reading the ref there would strand
   * color changes on blocks whose path never moves (a neighbour highlighting
   * because its edge got selected), since `setRenderedPath` bails on an
   * unchanged path and no re-render would follow.
   */
  const frameRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)
  const hoveredPortRef = useRef<string | null>(null)
  const draggedPortRef = useRef<string | null>(null)
  /** Whether the pointer is on an edge at all; the frame decides the rest. */
  const cursorHoverAllowedRef = useRef(false)
  /** True while the swell is deswelling at a zone boundary to cross behind. */
  const zoneCrossingRef = useRef(false)
  const hoverSpringRef = useRef<SpringValue>({ value: 0, velocity: 0, target: 0 })
  const actionMenuSpringRef = useRef<SpringValue>({ value: 0, velocity: 0, target: 0 })
  const cursorAmplitudeRef = useRef<SpringValue>({ value: 0, velocity: 0, target: 0 })
  const cursorSRef = useRef<SpringValue>({ value: 0, velocity: 0, target: 0 })
  const startAnimationRef = useRef<() => void>(() => {})
  /** Synchronous single-frame repaint, for geometry changes that must not lag. */
  const renderNowRef = useRef<() => void>(() => {})
  const updatePointerTargetRef = useRef<(x: number, y: number) => void>(() => {})
  const resetPointerTrackingRef = useRef<() => void>(() => {})
  const onCursorHandleChangeRef = useRef(onCursorHandleChange)
  const onActionMenuReadyChangeRef = useRef(onActionMenuReadyChange)
  const actionMenuReadyRef = useRef(false)
  const sizeRef = useRef(size)
  const geometryRef = useRef<
    PerimeterGeometry & {
      ports: PortSample[]
    }
  >({ samples: [], segments: [], ports: [], length: 1 })
  sizeRef.current = size
  onCursorHandleChangeRef.current = onCursorHandleChange
  onActionMenuReadyChangeRef.current = onActionMenuReadyChange

  /*
   * The silhouette is always measured off the host it is painted on, never
   * taken from the caller's number.
   *
   * The SVG is sized `calc(100% + padding)` of the host but its viewBox is
   * built from `size`, under `preserveAspectRatio='none'` — so any gap between
   * the two silently rescales the whole outline, and the card's content spills
   * past a border drawn for a different height. Card hosts size themselves from
   * their content against a `minHeight`, and the deterministic estimate behind
   * that number cannot model a wrapped summary line or an expanded MCP arg
   * list, so the two do drift.
   *
   * `width`/`height` remain as the seed for the very first paint (see the
   * `useState` above), which is what keeps a card from flashing a default-sized
   * outline before layout settles. After that the DOM is the only authority.
   */
  useLayoutEffect(() => {
    const host = svgRef.current?.parentElement
    if (!host) return
    const update = () => {
      /* offsetWidth/Height, not getBoundingClientRect: the card sits inside
         the canvas' zoom transform and a scaled rect would drift the geometry. */
      const nextWidth = host.offsetWidth
      /* Taken as-is. The MIN_PAINTED_HEIGHT floor belongs to the block card,
         which applies it to its own host — imposing it here would inflate the
         silhouette of every deliberately shorter surface that shares this
         border, starting with the 34px subflow Start pill. A zero height (a
         detached or display:none host) is rejected by the guard below, leaving
         the seed in place. */
      const nextHeight = host.offsetHeight
      if (
        Number.isFinite(nextWidth) &&
        Number.isFinite(nextHeight) &&
        nextWidth > 0 &&
        nextHeight > 0
      ) {
        setSize((current) =>
          current.width === nextWidth && current.height === nextHeight
            ? current
            : { width: nextWidth, height: nextHeight }
        )
      }
    }
    update()
    /* Absent in jsdom and any non-DOM renderer. The synchronous `update()`
       above already sized the outline off the host, so the card still paints
       correctly — it just will not follow later content changes. */
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const perimeter = buildRoundedRectPerimeter(size.width, size.height, radius)
    const resolvedPorts = resolvePortSamples(ports, perimeter.samples, size.width, size.height)
    geometryRef.current = {
      samples: perimeter.samples,
      segments: perimeter.segments,
      ports: resolvedPorts,
      length: perimeter.length,
    }
    const actionMenuPort = resolvedPorts.find((port) => port.id === 'action-menu')
    actionMenuSpringRef.current.target = (actionMenuPort?.restAmplitude ?? 0) > 0 ? 1 : 0
    /* Repaint in the same commit: ports or size changed, and a silhouette
       that lags the content by an animation frame reads as a flash. */
    renderNowRef.current()
  }, [ports, radius, size.height, size.width])

  useLayoutEffect(() => {
    const svg = svgRef.current
    const host = svg?.parentElement
    if (!svg || !host) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /*
     * One frame in flight at a time, tracked in frameRef. If a frame dies —
     * an exception, or a stale handle left by an HMR remount — frameRef must
     * be released, or startAnimation() treats the dead frame as pending and
     * the card never paints again. The wrapper guarantees the loop can always
     * restart from the next pointer event.
     */
    const scheduleFrame = () => {
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(render)
      }
    }

    const render = (timestamp: number) => {
      frameRef.current = null
      try {
        renderFrame(timestamp)
      } catch (error) {
        frameRef.current = null
        lastFrameRef.current = 0
        throw error
      }
    }

    const renderFrame = (timestamp: number) => {
      const geometry = geometryRef.current
      if (geometry.samples.length === 0) {
        onCursorHandleChangeRef.current?.(null)
        frameRef.current = null
        return
      }
      const deltaSeconds = getWorkflowBorderFrameDeltaSeconds(timestamp, lastFrameRef.current)
      if (Number.isFinite(timestamp) && timestamp > lastFrameRef.current) {
        lastFrameRef.current = timestamp
      }

      const hoverSpring = hoverSpringRef.current
      const actionMenuSpring = actionMenuSpringRef.current
      const cursorAmplitude = cursorAmplitudeRef.current
      const cursorS = cursorSRef.current
      const actionMenuPort = geometry.ports.find((port) => port.id === 'action-menu')
      actionMenuSpring.target = (actionMenuPort?.restAmplitude ?? 0) > 0 ? 1 : 0
      /*
       * Two different colours must never share one silhouette. The swell is the
       * base colour, a connected or error knob is painted over it — a merged
       * shape would be part knob colour and part gray, reading as the colours
       * bleeding into each other. Same-colour knobs are exempt: gray merging
       * into gray is the gooey join, not a blend.
       *
       * Fading alone cannot guarantee that — the amplitude spring takes real
       * time to decay, and during those frames the still-visible swell keeps
       * travelling and sweeps straight across the knob. So the exclusion is
       * structural: while the swell is meaningfully visible its position is
       * pinned at the zone boundary (bulges touching, never overlapping), it
       * deswells there on the snap spring, and once it drops under the crossing
       * amplitude it steps to the boundary on the pointer's side and grows
       * back — a continuous pass-behind, not a die-and-restart.
       */
      const coloredZoneFor = (arc: number, slack = 0) => {
        for (const port of geometry.ports) {
          if (!port.color || port.magnetizable === false) continue
          const profile = getPortBulgeProfile(port)
          const clearance = profile.plateau / 2 + profile.shoulder + CURSOR_HALF_FOOTPRINT_PX
          if (arcDistance(arc, port.s, geometry.length) < clearance + slack) {
            return { port, clearance }
          }
        }
        return null
      }
      const targetZone = coloredZoneFor(cursorS.target)
      /*
       * Hovering ANY resting knob hands the interaction over to it — the knob
       * takes its hover size while the swell deswells away, regardless of
       * colour. Same-colour merging still happens in transit (the swell can
       * slide across a gray knob gooily), but a direct hover always snaps:
       * for knobs narrower than the swell, merging instead lets the swell
       * swallow the knob it is supposed to be handing off to. hoveredPortRef
       * only ever holds magnetizable ports, so the action menu never triggers
       * this.
       */
      const snappingToKnob = hoveredPortRef.current !== null
      /*
       * The crossing latch, not a live threshold test: a threshold alone
       * oscillates — the instant amplitude dips below it the target flips back
       * to 1 and pumps it up again, and the swell hangs at the boundary
       * forever. Latched at the pin, released only by completing the crossing
       * or by the swell moving clear of the zone.
       */
      if (zoneCrossingRef.current && coloredZoneFor(cursorS.value, 1) === null) {
        zoneCrossingRef.current = false
      }
      const handingOff = Boolean(targetZone) || snappingToKnob || zoneCrossingRef.current
      cursorAmplitude.target = cursorHoverAllowedRef.current && !handingOff ? 1 : 0
      if (reducedMotion) {
        hoverSpring.value = hoverSpring.target
        hoverSpring.velocity = 0
        actionMenuSpring.value = actionMenuSpring.target
        actionMenuSpring.velocity = 0
        cursorAmplitude.value = cursorAmplitude.target
        cursorAmplitude.velocity = 0
        cursorS.value = cursorS.target
        cursorS.velocity = 0
      } else {
        springStep(hoverSpring, deltaSeconds, SPRING_STIFFNESS, SPRING_DAMPING, {
          min: 0,
          max: 1,
        })
        springStep(
          actionMenuSpring,
          deltaSeconds,
          ACTION_MENU_SPRING_STIFFNESS,
          ACTION_MENU_SPRING_DAMPING,
          { min: 0, max: 1 }
        )
        /* Hand-offs to a knob deswell on the stiffer snap spring — quick but
           still a motion, neither a blink nor a loitering blob. */
        springStep(
          cursorAmplitude,
          deltaSeconds,
          handingOff ? CURSOR_SNAP_SPRING_STIFFNESS : SPRING_STIFFNESS,
          handingOff ? CURSOR_SNAP_SPRING_DAMPING : SPRING_DAMPING,
          { min: 0, max: 1 }
        )
        if (cursorAmplitude.target === 0 && cursorAmplitude.value < 0.005) {
          cursorAmplitude.value = 0
          cursorAmplitude.velocity = 0
        }
        const delta = shortestArcDelta(cursorS.value, cursorS.target, geometry.length)
        const unwrappedTarget = cursorS.value + delta
        const originalTarget = cursorS.target
        cursorS.target = unwrappedTarget
        springStep(cursorS, deltaSeconds)
        cursorS.value = modulo(cursorS.value, geometry.length)
        cursorS.target = originalTarget
      }

      const actionMenuReady = isActionMenuSwellReady(
        actionMenuSpring.target,
        actionMenuSpring.value
      )
      if (actionMenuReady !== actionMenuReadyRef.current) {
        actionMenuReadyRef.current = actionMenuReady
        onActionMenuReadyChangeRef.current?.(actionMenuReady)
      }

      const valueZone = coloredZoneFor(cursorS.value)
      if (valueZone) {
        if (cursorAmplitude.value <= CURSOR_CROSSING_AMPLITUDE && !targetZone) {
          /* Faint enough to cross: step out at the boundary on the pointer's
             side, keeping the residual amplitude so growth resumes at once. */
          const toTarget = shortestArcDelta(valueZone.port.s, cursorS.target, geometry.length)
          const side = toTarget !== 0 ? Math.sign(toTarget) : -1
          cursorS.value = modulo(valueZone.port.s + side * valueZone.clearance, geometry.length)
          cursorS.velocity = 0
          zoneCrossingRef.current = false
        } else if (cursorAmplitude.value > 0.005) {
          /* Still visible: pinned at the boundary on its current side. */
          const offset = shortestArcDelta(valueZone.port.s, cursorS.value, geometry.length)
          const side = offset !== 0 ? Math.sign(offset) : -1
          cursorS.value = modulo(valueZone.port.s + side * valueZone.clearance, geometry.length)
          cursorS.velocity = 0
          if (!targetZone) zoneCrossingRef.current = true
        }
      }

      const activePortId = draggedPortRef.current ?? hoveredPortRef.current
      if (cursorAmplitude.value * CURSOR_PEAK_PX >= BULGE_VISIBLE_THRESHOLD_PX && !handingOff) {
        const { point } = pointAtArcLength(geometry, cursorS.value)
        const edgeSide = getPerimeterPointSide(point)
        const side =
          edgeSide === 'left' || edgeSide === 'right'
            ? edgeSide
            : getConnectionSideForPoint(point.x, sizeRef.current.width)
        onCursorHandleChangeRef.current?.({
          side,
          edgeSide,
          x: point.x + point.nx * CONNECTION_KNOB_PEAK_PX,
          y: point.y + point.ny * CONNECTION_KNOB_PEAK_PX,
        })
      } else {
        onCursorHandleChangeRef.current?.(null)
      }
      const maxPortPeak = geometry.ports.reduce(
        (current, port) =>
          Math.max(
            current,
            getPortPeak(port) *
              Math.min(
                MAX_PORT_AMPLITUDE,
                Math.max(
                  0,
                  Number.isFinite(port.hoverAmplitude) ? (port.hoverAmplitude ?? 1.15) : 1.15
                )
              )
          ),
        CURSOR_PEAK_PX
      )
      const maxPeak = Math.min(
        MAX_SILHOUETTE_OUTSET_PX,
        Math.max(maxPortPeak, CURSOR_PEAK_PX * cursorAmplitude.value)
      )
      const features: BulgeFeature[] = geometry.ports.map((port) => {
        const profile = getPortBulgeProfile(port)
        const rest = Math.min(
          MAX_PORT_AMPLITUDE,
          Math.max(0, Number.isFinite(port.restAmplitude) ? (port.restAmplitude ?? 1) : 1)
        )
        const hover = Math.min(
          MAX_PORT_AMPLITUDE,
          Math.max(0, Number.isFinite(port.hoverAmplitude) ? (port.hoverAmplitude ?? 1.15) : 1.15)
        )
        const multiplier =
          port.id === 'action-menu'
            ? hover * actionMenuSpring.value
            : Math.max(
                port.revealOnCardHover ? rest + (hover - rest) * hoverSpring.value : rest,
                port.id === activePortId ? hover : 0
              )
        return {
          center: port.s,
          plateau: profile.plateau,
          peak: getPortPeak(port) * multiplier,
          shoulder: profile.shoulder,
          falloff: port.id === 'action-menu' ? 'action-menu' : undefined,
        }
      })
      if (cursorAmplitude.value >= 0.005) {
        features.push({
          center: cursorS.value,
          plateau: CURSOR_SWELL_LENGTH_PX * CONNECTION_PLATEAU_RATIO,
          peak: CURSOR_PEAK_PX * cursorAmplitude.value,
          shoulder: CURSOR_SWELL_LENGTH_PX * CONNECTION_SHOULDER_RATIO,
        })
      }
      const nextPath = buildPiecewisePath(
        {
          samples: geometry.samples,
          segments: geometry.segments,
          length: geometry.length,
        },
        features,
        maxPeak
      )
      const perimeter = {
        samples: geometry.samples,
        segments: geometry.segments,
        length: geometry.length,
      }
      const actionFeature = features.find((feature) => feature.falloff === 'action-menu')
      const actionSwellUp = actionFeature !== undefined && actionFeature.peak > 0.5
      const actionHalf = actionFeature ? actionFeature.plateau / 2 + actionFeature.shoulder : 0
      const nextKnobs = geometry.ports
        .map((port, index) => ({ port, feature: features[index] }))
        .filter(({ port, feature }) => Boolean(port.color) && feature !== undefined)
        /*
         * A knob under the open action swell is simply not painted: the swell
         * is a lid, and paint that survives beneath it either bleeds through
         * mid-animation or reads as the knob changing colour behind the menu.
         * The connection anchor (the invisible handle) stays put, so the edge
         * still terminates at the card edge — the line just disappears under
         * the swell. The knob returns the moment the swell closes.
         */
        .filter(
          ({ port }) =>
            !actionSwellUp ||
            !actionFeature ||
            arcDistance(port.s, actionFeature.center, geometry.length) > actionHalf
        )
        .map(({ port, feature }) => {
          const half = visibleBulgeHalf(feature.plateau, feature.shoulder, feature.peak)
          /*
           * Colour follows only this knob's own bulge. Feeding the full feature
           * list (including the action-menu swell) re-displaced the dark stroke
           * up onto the ActionBar peak, so the knob looked anchored to the menu
           * instead of the card edge and covered the icons.
           */
          return {
            id: port.id,
            color: port.color as string,
            d: buildSpanPath(perimeter, [feature], feature.peak, port.s - half, port.s + half),
          }
        })
      /*
       * The action-menu swell must sit OVER any knob or line beneath it: a
       * top-centre connection stays anchored to the card edge, and the opening
       * swell slides across and hides it. The knobs paint at their resting
       * positions above, so the swell's region is repainted after them in the
       * silhouette colour — an opaque lid, matching the outline the swell
       * already drew.
       */
      const nextOverlay =
        actionSwellUp && actionFeature
          ? buildSpanPath(
              perimeter,
              features,
              maxPeak,
              actionFeature.center - actionHalf,
              actionFeature.center + actionHalf
            )
          : ''
      const nextKnobKey = `${nextKnobs.map((knob) => `${knob.id}:${knob.color}:${knob.d}`).join('|')}~${nextOverlay}`
      setRenderedPath((current) =>
        current.d === nextPath.d && current.knobKey === nextKnobKey
          ? current
          : { ...nextPath, knobs: nextKnobs, knobKey: nextKnobKey, overlay: nextOverlay }
      )

      const moving =
        !springAtRest(hoverSpring) ||
        !springAtRest(actionMenuSpring) ||
        !springAtRest(cursorAmplitude) ||
        !springAtRest(cursorS)
      if (moving) {
        scheduleFrame()
      } else {
        frameRef.current = null
        lastFrameRef.current = 0
      }
    }

    const startAnimation = () => {
      if (frameRef.current === null) {
        lastFrameRef.current = 0
        scheduleFrame()
      }
    }
    startAnimationRef.current = startAnimation
    renderNowRef.current = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      render(performance.now())
    }

    let trackingPointer = false
    let leaveConfirmFrame: number | null = null
    const lastPointerRef = { x: 0, y: 0 }
    // Include the action-tab / top bridge siblings so opening the action menu
    // does not look like a leave and kill the cursor-follow connection swell.
    const trackingRoot = (host.closest('.react-flow__node') as HTMLElement | null) ?? host

    const stopPointerTracking = () => {
      // Keep the cursor source handle mounted while a connection drag is active;
      // clearing it on leave unmounts the Handle and kills the drag.
      if (draggedPortRef.current) return
      if (leaveConfirmFrame !== null) {
        cancelAnimationFrame(leaveConfirmFrame)
        leaveConfirmFrame = null
      }
      hoveredPortRef.current = null
      hoverSpringRef.current.target = 0
      cursorHoverAllowedRef.current = false
      cursorAmplitudeRef.current.target = 0
      cursorAmplitudeRef.current.velocity = 0
      if (trackingPointer) {
        window.removeEventListener('pointermove', onTrackedPointerMove)
        trackingPointer = false
      }
      startAnimation()
    }

    const beginPointerTracking = () => {
      if (leaveConfirmFrame !== null) {
        cancelAnimationFrame(leaveConfirmFrame)
        leaveConfirmFrame = null
      }
      if (trackingPointer) return
      trackingPointer = true
      window.addEventListener('pointermove', onTrackedPointerMove)
    }

    const isWithinTrackingBounds = (clientX: number, clientY: number) => {
      const rect = host.getBoundingClientRect()
      return (
        clientX >= rect.left - CURSOR_TRACKING_MARGIN_PX &&
        clientX <= rect.right + CURSOR_TRACKING_MARGIN_PX &&
        clientY >= rect.top - CURSOR_TRACKING_MARGIN_PX &&
        clientY <= rect.bottom + CURSOR_TRACKING_MARGIN_PX
      )
    }

    const isPointerOverTrackingRoot = (clientX: number, clientY: number) => {
      if (isWithinTrackingBounds(clientX, clientY)) return true
      const top = document.elementFromPoint(clientX, clientY)
      return Boolean(top && trackingRoot.contains(top))
    }

    const updatePointerTarget = (clientX: number, clientY: number) => {
      if (draggedPortRef.current) return
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return
      lastPointerRef.x = clientX
      lastPointerRef.y = clientY
      const { width: layoutWidth, height: layoutHeight } = sizeRef.current
      if (layoutWidth <= 0 || layoutHeight <= 0) return
      if (!isWithinTrackingBounds(clientX, clientY)) {
        // Still over the node chrome (action tab / bridge) — keep listening so
        // returning to an edge immediately restores the swell.
        if (isPointerOverTrackingRoot(clientX, clientY)) {
          /*
           * Only the in-band path below recomputes the magnetized port, so
           * leaving the band upward onto the action bar left the last knob
           * pinned at hover amplitude — a port puffed out with the pointer
           * nowhere near it.
           */
          hoveredPortRef.current = null
          cursorHoverAllowedRef.current = false
          cursorAmplitudeRef.current.target = 0
          startAnimation()
          return
        }
        stopPointerTracking()
        return
      }
      const rect = host.getBoundingClientRect()
      const geometry = geometryRef.current
      const scaleX = rect.width / layoutWidth
      const scaleY = rect.height / layoutHeight
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        cursorHoverAllowedRef.current = false
        cursorAmplitudeRef.current.target = 0
        startAnimation()
        return
      }
      const scale = Math.min(scaleX, scaleY)
      const localX = (clientX - rect.left) / scaleX
      const localY = (clientY - rect.top) / scaleY
      if (!Number.isFinite(localX) || !Number.isFinite(localY) || !Number.isFinite(scale)) {
        cursorHoverAllowedRef.current = false
        cursorAmplitudeRef.current.target = 0
        startAnimation()
        return
      }
      const nearest = closestSample(geometry.samples, localX, localY)
      const cursorSideAllowed =
        cursorSwellSides === undefined ||
        cursorSwellSides.includes(getPerimeterPointSide(nearest.sample))
      const nearestPort = geometry.ports
        .filter((port) => port.magnetizable !== false)
        .map((port) => ({
          port,
          distance: arcDistance(nearest.sample.s, port.s, geometry.length),
        }))
        .sort((a, b) => a.distance - b.distance)[0]
      const outwardDistance =
        (localX - nearest.sample.x) * nearest.sample.nx +
        (localY - nearest.sample.y) * nearest.sample.ny
      const edgeDepth = outwardDistance > 0 ? CURSOR_EDGE_OUTSET_PX : CURSOR_EDGE_INSET_PX
      const inEdgeZone = nearest.distance * scale <= edgeDepth
      /*
       * Magnetize toward ANY nearby port, connected knobs included. The cursor
       * swell then slides into the existing knob and the two bulges coincide,
       * reading as one shape, instead of the swell blinking out as it nears.
       */
      const magnetized =
        inEdgeZone &&
        cursorSideAllowed &&
        nearestPort !== undefined &&
        nearestPort.distance * scale <= MAGNETIZE_DISTANCE_PX
      const hitElement = document.elementFromPoint(clientX, clientY)
      const pointerOverActionControl =
        hitElement instanceof Element &&
        Boolean(
          hitElement.closest('[data-workflow-action-bar-swell], [data-workflow-action-bar-bridge]')
        )
      /*
       * The action bar blocks connection interaction only where its DOM is
       * actually hit. Its broad SVG shoulders are visual chrome and must not
       * consume the usable top-left/top-right card edge beneath them.
       */
      const cursorDisplacementVisible = inEdgeZone && cursorSideAllowed && !pointerOverActionControl
      cursorSRef.current.target =
        magnetized && !nearestPort.port.color ? nearestPort.port.s : nearest.sample.s
      /*
       * Whether an edge hover is allowed at all. Whether the swell is actually
       * drawn is decided per frame in the render loop, against where the swell
       * has sprung to rather than where the pointer is — see there for why.
       */
      cursorHoverAllowedRef.current = cursorDisplacementVisible
      cursorAmplitudeRef.current.target = cursorDisplacementVisible ? 1 : 0
      if (pointerOverActionControl) {
        cursorAmplitudeRef.current.value = 0
        cursorAmplitudeRef.current.velocity = 0
      }
      hoveredPortRef.current = magnetized ? nearestPort.port.id : null
      startAnimation()
    }

    const onTrackedPointerMove = (event: PointerEvent) => {
      updatePointerTarget(event.clientX, event.clientY)
    }

    const onPointerEnter = (event: PointerEvent) => {
      hoverSpringRef.current.target = 1
      beginPointerTracking()
      updatePointerTarget(event.clientX, event.clientY)
      startAnimation()
    }

    const onPointerLeave = (event: PointerEvent) => {
      const next = event.relatedTarget
      if (next instanceof Node && trackingRoot.contains(next)) return
      // DOM churn from the action tab / updateNodeInternals often yields a null
      // relatedTarget while the pointer is still over the card. Confirm on the
      // next frame before tearing the swell down.
      if (leaveConfirmFrame !== null) cancelAnimationFrame(leaveConfirmFrame)
      leaveConfirmFrame = requestAnimationFrame(() => {
        leaveConfirmFrame = null
        if (draggedPortRef.current) return
        if (isPointerOverTrackingRoot(lastPointerRef.x, lastPointerRef.y)) {
          beginPointerTracking()
          updatePointerTarget(lastPointerRef.x, lastPointerRef.y)
          return
        }
        stopPointerTracking()
      })
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const handle = target.closest<HTMLElement>('[data-handleid]')
      if (!handle) return
      draggedPortRef.current = handle.dataset.handleid ?? null
      startAnimation()
    }

    const onPointerUp = (event: PointerEvent) => {
      draggedPortRef.current = null
      if (!isPointerOverTrackingRoot(event.clientX, event.clientY)) {
        stopPointerTracking()
        return
      }
      beginPointerTracking()
      updatePointerTarget(event.clientX, event.clientY)
    }

    updatePointerTargetRef.current = updatePointerTarget
    resetPointerTrackingRef.current = stopPointerTracking
    if (cursorSwellEnabled && canStartConnection) {
      trackingRoot.addEventListener('pointerenter', onPointerEnter)
      trackingRoot.addEventListener('pointerleave', onPointerLeave)
      trackingRoot.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('pointerup', onPointerUp)
      if (trackingRoot.matches(':hover')) {
        hoverSpringRef.current.target = 1
        beginPointerTracking()
      }
    } else {
      hoveredPortRef.current = null
      draggedPortRef.current = null
      hoverSpringRef.current = { value: 0, velocity: 0, target: 0 }
      cursorHoverAllowedRef.current = false
      cursorAmplitudeRef.current = { value: 0, velocity: 0, target: 0 }
      cursorSRef.current.velocity = 0
      cursorSRef.current.value = cursorSRef.current.target
    }
    /*
     * First paint is synchronous, inside this layout effect, so a card never
     * commits a frame without its border. Deferring to the animation frame
     * painted the content one frame before the silhouette — every mount
     * flashed a bodiless card, and a suspended tab never painted one at all.
     */
    render(performance.now())

    return () => {
      startAnimationRef.current = () => {}
      renderNowRef.current = () => {}
      updatePointerTargetRef.current = () => {}
      resetPointerTrackingRef.current = () => {}
      onCursorHandleChangeRef.current?.(null)
      if (leaveConfirmFrame !== null) cancelAnimationFrame(leaveConfirmFrame)
      trackingRoot.removeEventListener('pointerenter', onPointerEnter)
      trackingRoot.removeEventListener('pointerleave', onPointerLeave)
      trackingRoot.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onTrackedPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [canStartConnection, cursorSwellEnabled, cursorSwellSides])

  useEffect(() => {
    if (!cursorSwellEnabled) {
      resetPointerTrackingRef.current()
      return
    }
    /*
     * Nothing to reset on this exit: the tracker is shared with this card's own
     * hover, a separate capability, and clearing it would undo the layout
     * effect's `:hover` bootstrap for a card that mounted under the pointer.
     */
    if (!canReceiveConnection) return

    /*
     * A connection drag captures the pointer on the origin card's handle, so
     * this card sees no pointerenter. Window pointermove still fires; feeding
     * it into the same tracker gives the dragged line a live edge swell to aim
     * at, and magnetization highlights the knob it would land on.
     *
     * Every card on the canvas listens during a drag, so the cost discipline
     * matters: moves are coalesced to one evaluation per frame, that
     * evaluation is a single rect test, and a card the pointer is nowhere
     * near does nothing at all. Only the transition out of range pays for one
     * reset. Without this, a 50-card canvas ran a DOM hit-test and scheduled
     * a render on every card for every pointermove of the drag.
     */
    let engaged = false
    let framePending = false
    let foreignFrameId: number | null = null
    let pointerX = 0
    let pointerY = 0
    const evaluate = () => {
      framePending = false
      foreignFrameId = null
      const el = svgRef.current?.parentElement
      if (!el) return
      const rect = el.getBoundingClientRect()
      const margin = CURSOR_TRACKING_MARGIN_PX
      const inRange =
        pointerX >= rect.left - margin &&
        pointerX <= rect.right + margin &&
        pointerY >= rect.top - margin &&
        pointerY <= rect.bottom + margin
      if (inRange) {
        engaged = true
        updatePointerTargetRef.current(pointerX, pointerY)
      } else if (engaged) {
        engaged = false
        resetPointerTrackingRef.current()
      }
    }
    const onForeignMove = (event: PointerEvent) => {
      const connectionNodeId = getConnectionNodeId?.()
      if (!nodeId || connectionNodeId == null || connectionNodeId === nodeId) return
      pointerX = event.clientX
      pointerY = event.clientY
      if (!framePending) {
        framePending = true
        foreignFrameId = requestAnimationFrame(evaluate)
      }
    }

    window.addEventListener('pointermove', onForeignMove)

    return () => {
      window.removeEventListener('pointermove', onForeignMove)
      if (foreignFrameId !== null) {
        cancelAnimationFrame(foreignFrameId)
      }
      resetPointerTrackingRef.current()
    }
  }, [canReceiveConnection, cursorSwellEnabled, getConnectionNodeId, nodeId])

  const ring = resolveRing(ringStyles)
  const { d: path } = renderedPath
  const silhouetteColor =
    silhouetteColorOverride ??
    (isSelected
      ? (selectedSilhouetteColor ?? 'var(--text-secondary)')
      : hasRing && ring.solid
        ? ring.color
        : 'var(--border-1)')

  return (
    <svg
      ref={svgRef}
      data-workflow-block-border=''
      viewBox={`${-BORDER_PADDING_PX} ${-BORDER_PADDING_PX} ${size.width + BORDER_PADDING_PX * 2} ${size.height + BORDER_PADDING_PX * 2}`}
      preserveAspectRatio='none'
      className='pointer-events-none absolute z-0 overflow-visible'
      style={{
        top: -BORDER_PADDING_PX,
        left: -BORDER_PADDING_PX,
        width: `calc(100% + ${BORDER_PADDING_PX * 2}px)`,
        height: `calc(100% + ${BORDER_PADDING_PX * 2}px)`,
      }}
      aria-hidden='true'
      focusable='false'
    >
      {path && (
        <defs>
          <clipPath id={clipId}>
            <path d={path} />
          </clipPath>
        </defs>
      )}
      {hasRing && !isSelected && !ring.solid && path && (
        <path
          d={path}
          fill='none'
          stroke={ring.color}
          strokeWidth={ring.width}
          className={ring.pulse ? 'animate-ring-pulse' : undefined}
        />
      )}
      {path && (
        <>
          <path
            d={path}
            fill={silhouetteColor}
            stroke={silhouetteColor}
            strokeWidth={SILHOUETTE_STROKE_WIDTH_PX}
          />
          {/*
           * The knob's share of the silhouette outline, recoloured. Half the
           * outline's width falls outside the filled shape, and the body fill
           * below is clipped to that shape — so without this a hairline of the
           * silhouette colour survives all the way around each coloured knob,
           * reading as a light halo bleeding into it.
           */}
          {renderedPath.knobs.map((knob) => (
            <path
              key={`${knob.id}-outline`}
              d={knob.d}
              fill='none'
              stroke={knob.color}
              strokeWidth={SILHOUETTE_STROKE_WIDTH_PX}
            />
          ))}
          <g clipPath={`url(#${clipId})`}>
            {renderedPath.knobs.map((knob) => (
              <path
                key={knob.id}
                d={knob.d}
                fill='none'
                stroke={knob.color}
                strokeWidth={PORT_FILL_STROKE_WIDTH_PX}
              />
            ))}
          </g>
          {renderedPath.overlay && (
            <>
              <path d={`${renderedPath.overlay} Z`} fill={silhouetteColor} />
              <path
                d={renderedPath.overlay}
                fill='none'
                stroke={silhouetteColor}
                strokeWidth={SILHOUETTE_STROKE_WIDTH_PX}
              />
            </>
          )}
          <rect
            x='0.75'
            y='0.75'
            width={Math.max(0, size.width - 1.5)}
            height={Math.max(0, size.height - 1.5)}
            rx={Math.max(0, radius - 0.75)}
            fill={bodyFill}
          />
        </>
      )}
      {path && (
        <path
          d={path}
          fill='none'
          stroke='transparent'
          strokeWidth={CURSOR_TRACKING_MARGIN_PX * 2}
          pointerEvents='stroke'
        />
      )}
    </svg>
  )
}
