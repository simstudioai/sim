/**
 * Runs the background executor for as long as the app is signed in: registers this install as a
 * device, keeps the inbox doorbell open, reads the inbox on every ring and on Sim's reconcile
 * timer, and follows sleep, wake and network changes. One per process, which the single-instance
 * lock makes one per machine.
 */
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { DesktopExecutorDevice } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { randomFloat } from '@sim/utils/random'
import { backoffWithJitter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import type { Session } from 'electron'
import { app, net, powerMonitor } from 'electron'
import {
  readFileWithinLimit,
  removeFileIfPresent,
  writeJsonFileAtomically,
} from '@/main/atomic-json-file'
import {
  createDesktopExecutorClient,
  type DesktopExecutorClient,
  DeviceRequestError,
} from '@/main/desktop-executor/client'
import { InboxDoorbell } from '@/main/desktop-executor/doorbell'
import {
  type DesktopApprovalItem,
  DesktopExecutor,
  type DesktopToolRunner,
} from '@/main/desktop-executor/executor'
import { createExecutorJournal } from '@/main/desktop-executor/journal'
import {
  DESKTOP_EXECUTOR_PROTOCOL_VERSION,
  type DesktopExecutorTiming,
  type DesktopImportEntryRequest,
  type DesktopImportedEntry,
} from '@/main/desktop-executor/protocol'

const logger = createLogger('DesktopExecutorService')

/** Batches the burst of cookie and preference events a sign-in produces into one registration. */
const REGISTRATION_DEBOUNCE_MS = 1_000
const REGISTRATION_RETRY_MAX_MS = 5 * 60_000
/** How often a device Sim has not enabled checks whether that changed. */
const DORMANT_RECHECK_MS = 15 * 60_000
const ONLINE_POLL_MS = 2_000
/** Spreads reconcile reads so devices that woke together do not read together. */
const RECONCILE_JITTER = 0.2

export interface DesktopExecutorServiceDeps {
  userDataPath: string
  origin: () => string
  appSession: () => Pick<Session, 'fetch'>
  preferences: () => { browserEnabled: boolean; terminalEnabled: boolean }
  accountDataAvailable: () => boolean
  runner: DesktopToolRunner
  onApprovals?: (items: DesktopApprovalItem[]) => void
  /** Whether any chat has desktop work claimed on this machine changed. */
  onBusyChange?: (busy: boolean) => void
}

export interface DesktopExecutorService {
  start(): void
  /** Re-registers after a sign-in, a session change, or a change to what this device can run. */
  refreshRegistration(): void
  getDevice(): DesktopExecutorDevice | null
  /** Stores one entry of a claimed import, as this device's registered session. */
  importEntry(
    request: DesktopImportEntryRequest,
    signal: AbortSignal
  ): Promise<DesktopImportedEntry>
  /** Sign-out: stops every action, forgets every call, and retires this install id. */
  signOut(): Promise<void>
}

/** The install id, kept in userData; a new one is minted after sign-out or a conflict. */
async function readInstallId(filePath: string): Promise<string | null> {
  let raw: string
  try {
    raw = (await readFileWithinLimit(filePath, 4096)).toString('utf8')
  } catch (error) {
    // Only a missing file means no id yet. Any other failure could be passing, and minting a new
    // id over it would orphan the calls bound to this one, so it is left to the next attempt.
    if (isRecordLike(error) && error.code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecordLike(parsed) && typeof parsed.deviceId === 'string' ? parsed.deviceId : null
  } catch {
    // Unreadable contents can never yield the id; a fresh one replaces them.
    return null
  }
}

/** Sim refuses a longer device name at registration. */
const DEVICE_NAME_MAX_CHARS = 128

/** The machine's name as the user knows it, within what Sim accepts. */
export function deviceName(host = hostname()): string {
  const name = host.replace(/\.local$/, '').trim() || 'Sim desktop'
  return truncate(name, DEVICE_NAME_MAX_CHARS - 3)
}

export function createDesktopExecutorService(
  deps: DesktopExecutorServiceDeps
): DesktopExecutorService {
  const identityPath = join(deps.userDataPath, 'desktop-executor-device.json')
  const journal = createExecutorJournal(join(deps.userDataPath, 'desktop-executor-journal.json'))

  let deviceId: string | null = null
  let device: DesktopExecutorDevice | null = null
  let timing: DesktopExecutorTiming | null = null
  let client: DesktopExecutorClient | null = null
  let executor: DesktopExecutor | null = null
  let doorbell: InboxDoorbell | null = null
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null
  let registrationTimer: ReturnType<typeof setTimeout> | null = null
  let registering = false
  let registerAgain = false
  let registrationAttempt = 0
  /** Logged once per run of missing routes, not on every recheck. */
  let routesMissingNoted = false
  /** The last registration failed with no answer from Sim at all. */
  let registrationFailedOffline = false
  let suspended = false
  let started = false
  /** Bumped on sign-out, so work started for the previous session cannot resume it. */
  let generation = 0
  let executorDeviceId: string | null = null

  async function installId(): Promise<string> {
    if (deviceId) return deviceId
    deviceId = (await readInstallId(identityPath)) ?? (await rotateInstallId())
    return deviceId
  }

  /**
   * Mints a new install id and makes it durable before anything uses it: an id the next launch
   * would not find again could never resume the calls bound to it. Fails if it cannot be saved.
   */
  async function rotateInstallId(): Promise<string> {
    const next = generateId()
    deviceId = null
    await writeJsonFileAtomically(identityPath, { deviceId: next })
    deviceId = next
    return next
  }

  /**
   * Retires the current install id for good: a new one replaces it, or, if that cannot be saved,
   * the old one is removed so no later launch or sign-in can pick it up again. False when neither
   * worked and the old id is still on disk.
   */
  async function retireInstallId(): Promise<boolean> {
    try {
      await rotateInstallId()
      return true
    } catch (error) {
      logger.warn('Could not save a new desktop install id', { error: getErrorMessage(error) })
    }
    try {
      await removeFileIfPresent(identityPath)
      return true
    } catch (error) {
      logger.warn('Could not remove the retired desktop install id', {
        error: getErrorMessage(error),
      })
      return false
    }
  }

  function fetchWithAppSession(url: string, init: RequestInit): Promise<Response> {
    return deps.appSession().fetch(url, init)
  }

  function scheduleReconcile(): void {
    if (reconcileTimer) clearTimeout(reconcileTimer)
    // Stopped loops (a dormant or unrecognized device) stay stopped until registration restarts them.
    if (!timing || !executor || !doorbell) return
    const delay = timing.reconcileMs * (1 - RECONCILE_JITTER + randomFloat() * RECONCILE_JITTER)
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      void executor?.reconcile().finally(scheduleReconcile)
    }, delay)
  }

  function ring(): void {
    if (suspended) return
    void executor?.reconcile()
  }

  /**
   * Sim stopped recognizing this device. With the executor on, the session changed under it, so
   * it registers again at once. With it off, Sim never recorded the device, so it stays quiet and
   * checks back later in case the executor is switched on.
   */
  function handleUnrecognized(): void {
    if (device) {
      scheduleRegistration()
      return
    }
    stopLoops()
    // Every refused request lands here; re-arming each time would push the recheck out forever.
    if (!registrationTimer) scheduleRegistration(DORMANT_RECHECK_MS)
  }

  function stopLoops(): void {
    doorbell?.stop()
    doorbell = null
    if (reconcileTimer) clearTimeout(reconcileTimer)
    reconcileTimer = null
  }

  /** Builds the executor for this install the first time Sim recognizes it. */
  async function startExecutor(
    id: string,
    nextTiming: DesktopExecutorTiming,
    registrationGeneration: number
  ): Promise<void> {
    if (executor && executorDeviceId !== id) await resetExecutor()
    timing = nextTiming
    if (!executor || !client) {
      executorDeviceId = id
      client = createDesktopExecutorClient({
        origin: deps.origin,
        fetch: fetchWithAppSession,
        deviceId: id,
      })
      executor = new DesktopExecutor({
        client,
        journal,
        runner: deps.runner,
        leaseRenewMs: nextTiming.leaseRenewMs,
        onUnregistered: handleUnrecognized,
        ...(deps.onApprovals ? { onApprovals: deps.onApprovals } : {}),
        ...(deps.onBusyChange ? { onBusyChange: deps.onBusyChange } : {}),
      })
      await executor.recover()
      // Signed out while recovering: sign-out already disposed this executor.
      if (registrationGeneration !== generation || !executor) return
    } else {
      executor.resumeParked()
    }
    if (!doorbell) {
      doorbell = new InboxDoorbell({
        client,
        onRing: ring,
        onUnregistered: handleUnrecognized,
      })
      if (!suspended) doorbell.start()
    }
    if (!suspended) void executor.reconcile()
    scheduleReconcile()
  }

  async function register(): Promise<void> {
    if (!deps.accountDataAvailable()) return
    const registrationGeneration = generation
    let id: string
    try {
      id = await installId()
    } catch (error) {
      registrationAttempt += 1
      logger.warn('Could not read the desktop install id', { error: getErrorMessage(error) })
      scheduleRegistration(
        backoffWithJitter(registrationAttempt, null, {
          baseMs: 2_000,
          maxMs: REGISTRATION_RETRY_MAX_MS,
        })
      )
      return
    }
    const preferences = deps.preferences()
    const registrationClient = createDesktopExecutorClient({
      origin: deps.origin,
      fetch: fetchWithAppSession,
      deviceId: id,
    })
    try {
      const nextTiming = await registrationClient.register({
        deviceId: id,
        name: deviceName(),
        appVersion: app.getVersion(),
        platform: `${process.platform}-${process.arch}`,
        capabilities: {
          executor: DESKTOP_EXECUTOR_PROTOCOL_VERSION,
          browser: preferences.browserEnabled,
          terminal: preferences.terminalEnabled,
          localFiles: deps.accountDataAvailable(),
        },
      })
      if (registrationGeneration !== generation || id !== deviceId) return
      registrationAttempt = 0
      registrationFailedOffline = false
      routesMissingNoted = false
      // A Sim that speaks another protocol version gets no new turns bound to this device.
      device =
        nextTiming.enabled && nextTiming.protocolVersion === DESKTOP_EXECUTOR_PROTOCOL_VERSION
          ? { deviceId: id, protocolVersion: DESKTOP_EXECUTOR_PROTOCOL_VERSION }
          : null
      logger.info('Desktop executor registered', { enabled: nextTiming.enabled })
      // Off for this user, and nothing here to finish: stay dormant. No inbox, no doorbell; only
      // a slow recheck, so switching the executor on in Sim reaches this device without a relaunch.
      if (!device && !executor && (await journal.load()).length === 0) {
        if (registrationGeneration !== generation) return
        scheduleRegistration(DORMANT_RECHECK_MS)
        return
      }
      // Off for this user mid-session, or results from a previous run to deliver: a turn already
      // bound here still finishes, so the executor serves the inbox; no new turn binds.
      await startExecutor(id, nextTiming, registrationGeneration)
    } catch (error) {
      if (registrationGeneration !== generation) return
      device = null
      if (error instanceof DeviceRequestError && error.status === 409) {
        // The id belongs to another account (a copied profile); this install takes a new one.
        logger.warn('Desktop install id is registered to another account; minting a new one')
        await resetExecutor()
        if (await retireInstallId()) {
          scheduleRegistration(0)
        } else {
          // The conflicting id is still on disk: retrying at once would only conflict again.
          registrationAttempt += 1
          scheduleRegistration(
            backoffWithJitter(registrationAttempt, null, {
              baseMs: 2_000,
              maxMs: REGISTRATION_RETRY_MAX_MS,
            })
          )
        }
        return
      }
      if (error instanceof DeviceRequestError && error.unregistered) {
        // Signed out: the next sign-in's session change registers again.
        stopLoops()
        return
      }
      if (error instanceof DeviceRequestError && (error.status === 404 || error.status === 405)) {
        // A Sim without the executor routes (older, or self-hosted): dormant, with only the slow
        // recheck, so an upgrade of Sim reaches this device without a relaunch.
        stopLoops()
        if (!routesMissingNoted) {
          routesMissingNoted = true
          logger.info('Sim does not offer the desktop background executor; staying dormant')
        }
        scheduleRegistration(DORMANT_RECHECK_MS)
        return
      }
      registrationFailedOffline = error instanceof DeviceRequestError && error.status === 0
      registrationAttempt += 1
      logger.warn('Desktop executor registration failed', {
        attempt: registrationAttempt,
        error: getErrorMessage(error),
      })
      scheduleRegistration(
        backoffWithJitter(registrationAttempt, null, {
          baseMs: 2_000,
          maxMs: REGISTRATION_RETRY_MAX_MS,
        })
      )
    }
  }

  function scheduleRegistration(delayMs = REGISTRATION_DEBOUNCE_MS): void {
    if (!started) return
    if (registrationTimer) clearTimeout(registrationTimer)
    registrationTimer = setTimeout(() => {
      registrationTimer = null
      void runRegistration()
    }, delayMs)
  }

  /** One registration at a time; a trigger that lands mid-flight registers once more after it. */
  async function runRegistration(): Promise<void> {
    if (registering) {
      registerAgain = true
      return
    }
    registering = true
    try {
      do {
        registerAgain = false
        await register()
      } while (registerAgain)
    } finally {
      registering = false
    }
  }

  async function resetExecutor(): Promise<void> {
    stopLoops()
    const current = executor
    executor = null
    executorDeviceId = null
    client = null
    timing = null
    device = null
    await current?.dispose()
  }

  function wake(): void {
    suspended = false
    executor?.setPaused(false)
    doorbell?.wake()
    void executor?.reconcile()
    scheduleReconcile()
  }

  function watchPowerAndNetwork(): void {
    powerMonitor.on('suspend', () => {
      suspended = true
      executor?.setPaused(true)
      doorbell?.stop()
    })
    powerMonitor.on('resume', wake)
    let online = net.isOnline()
    setInterval(() => {
      const now = net.isOnline()
      if (now && !online) {
        wake()
        // A registration that failed for want of a network need not wait out its backoff.
        if (registrationFailedOffline) scheduleRegistration(0)
      }
      online = now
    }, ONLINE_POLL_MS).unref?.()
  }

  return {
    start() {
      if (started) return
      started = true
      watchPowerAndNetwork()
      scheduleRegistration(0)
    },
    refreshRegistration() {
      scheduleRegistration()
    },
    getDevice() {
      return device
    },
    importEntry(request, signal) {
      if (!client) throw new Error('The Sim desktop app is not signed in to Sim.')
      return client.importEntry(request, signal)
    },
    async signOut() {
      // A registration in flight now answers for a session that is gone; it must not restart.
      generation += 1
      if (registrationTimer) clearTimeout(registrationTimer)
      registrationTimer = null
      await resetExecutor()
      await journal.clear()
      await retireInstallId()
    },
  }
}
