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
import { readFileWithinLimit, writeJsonFileAtomically } from '@/main/atomic-json-file'
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
  appSession: () => Session
  preferences: () => { browserEnabled: boolean; terminalEnabled: boolean }
  accountDataAvailable: () => boolean
  runner: DesktopToolRunner
  onApprovals?: (items: DesktopApprovalItem[]) => void
}

export interface DesktopExecutorService {
  start(): void
  /** Re-registers after a sign-in, a session change, or a change to what this device can run. */
  refreshRegistration(): void
  getDevice(): DesktopExecutorDevice | null
  /** Sign-out: stops every action, forgets every call, and retires this install id. */
  signOut(): Promise<void>
}

/** The install id, kept in userData; a new one is minted after sign-out or a conflict. */
async function readInstallId(filePath: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      (await readFileWithinLimit(filePath, 4096)).toString('utf8')
    ) as unknown
    return isRecordLike(parsed) && typeof parsed.deviceId === 'string' ? parsed.deviceId : null
  } catch {
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

  async function rotateInstallId(): Promise<string> {
    deviceId = generateId()
    await writeJsonFileAtomically(identityPath, { deviceId }).catch((error) =>
      logger.warn('Could not save the desktop install id', { error: getErrorMessage(error) })
    )
    return deviceId
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
    const id = await installId()
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
      // A Sim that speaks another protocol version gets no new turns bound to this device.
      device =
        nextTiming.enabled && nextTiming.protocolVersion === DESKTOP_EXECUTOR_PROTOCOL_VERSION
          ? { deviceId: id, protocolVersion: DESKTOP_EXECUTOR_PROTOCOL_VERSION }
          : null
      logger.info('Desktop executor registered', { enabled: nextTiming.enabled })
      // Off for this user: a turn already bound to this device still finishes here, so the
      // executor keeps serving the inbox; no new turn binds while `device` is null.
      await startExecutor(id, nextTiming, registrationGeneration)
    } catch (error) {
      if (registrationGeneration !== generation) return
      device = null
      if (error instanceof DeviceRequestError && error.status === 409) {
        // The id belongs to another account (a copied profile); this install takes a new one.
        logger.warn('Desktop install id is registered to another account; minting a new one')
        await resetExecutor()
        await rotateInstallId()
        scheduleRegistration(0)
        return
      }
      if (error instanceof DeviceRequestError && error.unregistered) {
        // Signed out: the next sign-in's session change registers again.
        stopLoops()
        return
      }
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
      if (now && !online) wake()
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
    async signOut() {
      // A registration in flight now answers for a session that is gone; it must not restart.
      generation += 1
      if (registrationTimer) clearTimeout(registrationTimer)
      registrationTimer = null
      await resetExecutor()
      await journal.clear()
      await rotateInstallId()
    },
  }
}
