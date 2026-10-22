/**
 * Event-loop health telemetry. One event loop serves every request in the
 * process, so a synchronous CPU burst in one request stalls all of them; this
 * makes that visible from the process itself.
 *
 * - Every {@link SNAPSHOT_INTERVAL_MS}, one INFO `Event loop snapshot` line with
 *   delay percentiles from `monitorEventLoopDelay`, process CPU share, and the
 *   in-flight route handler count.
 * - Whenever a {@link STALL_PROBE_MS} probe timer fires at least
 *   {@link STALL_WARN_MS} late, one WARN `Event loop stalled` line (at most
 *   {@link MAX_STALL_WARNINGS_PER_SNAPSHOT} per window) listing the route
 *   handlers in flight during the stall as concurrency context; see
 *   `in-flight-requests.ts` for what that list cannot attribute.
 *
 * Both lines are emitted after the loop recovers, since nothing on a blocked
 * loop can run; a stall that never ends shows up as a missing snapshot instead.
 *
 * Reading the numbers:
 * - On Bun the delay histogram records only the excess delay beyond the
 *   sampling timer, so an idle loop reads near 0 ms. On Node each sample
 *   includes the {@link HISTOGRAM_RESOLUTION_MS} resolution, so an idle loop
 *   reads about 20 ms. Compare values only within one runtime.
 * - A block is counted as a stall only once the probe is a full
 *   {@link STALL_WARN_MS} late, which takes a block of 1.0–1.25 s depending on
 *   where in the probe interval it starts. Shorter blocks show only in
 *   `lagMaxMs`.
 * - `performance.eventLoopUtilization()` is a stub of zeros on Bun, so `elu` is
 *   emitted only where it reports real values. `cpuPct` (process CPU share,
 *   which also counts GC and other threads) is the signal on both runtimes.
 */

import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { createLogger } from '@sim/logger'
import {
  findRequestsSpanningStall,
  getInFlightCount,
  takeInFlightWindow,
} from '@/lib/monitoring/in-flight-requests'

const logger = createLogger('EventLoopTelemetry', { logLevel: 'INFO' })

const SNAPSHOT_INTERVAL_MS = 60_000
const HISTOGRAM_RESOLUTION_MS = 20
const STALL_PROBE_MS = 250
const STALL_WARN_MS = 1_000
/** Caps WARN volume when the loop is stalling continuously; the snapshot still counts every stall. */
const MAX_STALL_WARNINGS_PER_SNAPSHOT = 10

const NS_PER_MS = 1e6

/** On `globalThis` so a second module instance (dev reloads, a second bundle graph) cannot start a second set of timers. */
const g = globalThis as typeof globalThis & { _simEventLoopTelemetryStarted?: boolean }

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Starts the snapshot and stall-probe timers once per process. Both timers are
 * unref'd, so they never keep the process alive. Called from instrumentation
 * at server start.
 */
export function startEventLoopTelemetry() {
  if (g._simEventLoopTelemetryStarted) return
  g._simEventLoopTelemetryStarted = true

  const histogram = monitorEventLoopDelay({ resolution: HISTOGRAM_RESOLUTION_MS })
  histogram.enable()

  let stallCount = 0
  let stallMaxMs = 0
  let stallTotalMs = 0
  let warningsThisWindow = 0

  let lastProbe = performance.now()
  const probe = setInterval(() => {
    const now = performance.now()
    const lateMs = now - lastProbe - STALL_PROBE_MS
    lastProbe = now
    if (lateMs < STALL_WARN_MS) return

    stallCount++
    stallTotalMs += lateMs
    if (lateMs > stallMaxMs) stallMaxMs = lateMs
    if (warningsThisWindow >= MAX_STALL_WARNINGS_PER_SNAPSHOT) return
    warningsThisWindow++

    logger.warn('Event loop stalled', {
      stallMs: Math.round(lateMs),
      inFlight: getInFlightCount(),
      inFlightDuringStall: findRequestsSpanningStall(now - lateMs, now),
    })
  }, STALL_PROBE_MS)
  probe.unref()

  let lastWall = performance.now()
  let lastCpu = process.cpuUsage()
  let lastElu = performance.eventLoopUtilization()

  const snapshot = setInterval(() => {
    const wallMs = performance.now() - lastWall
    const cpu = process.cpuUsage(lastCpu)
    const elu = performance.eventLoopUtilization(lastElu)
    const count = histogram.count
    const inFlightWindow = takeInFlightWindow()

    logger.info('Event loop snapshot', {
      lagP50Ms: count ? round(histogram.percentile(50) / NS_PER_MS) : 0,
      lagP99Ms: count ? round(histogram.percentile(99) / NS_PER_MS) : 0,
      lagMaxMs: count ? round(histogram.max / NS_PER_MS) : 0,
      lagMeanMs: count ? round(histogram.mean / NS_PER_MS) : 0,
      stalls: stallCount,
      stallMaxMs: Math.round(stallMaxMs),
      stallTotalMs: Math.round(stallTotalMs),
      cpuPct: wallMs > 0 ? round(((cpu.user + cpu.system) / 1000 / wallMs) * 100) : 0,
      ...(elu.idle + elu.active > 0 ? { elu: round(elu.utilization, 3) } : {}),
      inFlight: getInFlightCount(),
      inFlightPeak: inFlightWindow.peak,
      ...(inFlightWindow.dropped > 0 ? { inFlightDropped: inFlightWindow.dropped } : {}),
      windowMs: Math.round(wallMs),
    })

    histogram.reset()
    stallCount = 0
    stallMaxMs = 0
    stallTotalMs = 0
    warningsThisWindow = 0
    lastWall = performance.now()
    lastCpu = process.cpuUsage()
    lastElu = performance.eventLoopUtilization()
  }, SNAPSHOT_INTERVAL_MS)
  snapshot.unref()
}
