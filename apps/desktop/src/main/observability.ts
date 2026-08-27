import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import type { BrowserWindow, Details } from 'electron'
import { app, dialog } from 'electron'

const logger = createLogger('DesktopEvents')

const DEFAULT_MAX_BYTES = 1_000_000

export type DesktopEventName =
  | 'app_launch'
  | 'update_check'
  | 'update_feed'
  | 'update_downloaded'
  | 'update_error'
  | 'update_blocked_version'
  | 'update_manual_mode'
  | 'update_manual_download'
  | 'handoff_redeem_ok'
  | 'handoff_redeem_fail'
  | 'load_failure'
  | 'renderer_gone'
  | 'renderer_unresponsive'
  | 'child_process_gone'
  | 'main_unhandled_rejection'
  | 'main_uncaught_exception'
  | 'sign_out'
  | 'origin_changed'
  | 'handoff_started'
  | 'connect_handoff_started'
  | 'connect_handoff_open_fail'
  | 'connect_handoff_state_fail'
  | 'connect_handoff_ok'
  | 'connect_handoff_error'

export interface EventRecorder {
  readonly filePath: string
  record(name: DesktopEventName, data?: Record<string, string | number | boolean>): void
}

interface ProcessFailureSource {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
  on(event: 'uncaughtException', listener: (error: Error) => void): void
  removeListener(event: 'unhandledRejection', listener: (reason: unknown) => void): void
  removeListener(event: 'uncaughtException', listener: (error: Error) => void): void
}

export interface MainProcessFailureObserverDeps {
  events: EventRecorder
  getWindow: () => BrowserWindow | null
  processSource?: ProcessFailureSource
}

const FAILURE_DEDUPE_MS = 5_000

/**
 * Records native child-process failures and gives a fatal main-process error a
 * single native recovery surface. Error text is deliberately excluded from
 * the structured log because rejected values can contain request payloads or
 * credentials; the event kind and crash dumps are enough for triage.
 */
export function installMainProcessFailureObservers({
  events,
  getWindow,
  processSource = process,
}: MainProcessFailureObserverDeps): () => void {
  let fatalRecoveryOpen = false
  let lastChildFailure = ''
  let lastChildFailureAt = 0

  const onChildProcessGone = (_event: unknown, details: Details): void => {
    if (details.reason === 'clean-exit') return
    const signature = `${details.type}:${details.reason}:${details.exitCode}:${details.serviceName ?? ''}`
    const now = Date.now()
    if (signature === lastChildFailure && now - lastChildFailureAt < FAILURE_DEDUPE_MS) return
    lastChildFailure = signature
    lastChildFailureAt = now
    events.record('child_process_gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.serviceName ? { serviceName: details.serviceName } : {}),
    })
    logger.error('Electron child process exited unexpectedly', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  }

  const reportFatal = (
    name: 'main_unhandled_rejection' | 'main_uncaught_exception',
    value: unknown
  ): void => {
    if (fatalRecoveryOpen) return
    fatalRecoveryOpen = true
    events.record(name, { valueType: value instanceof Error ? 'Error' : typeof value })
    logger.error('Fatal main-process failure', { kind: name })
    const options = {
      type: 'error' as const,
      buttons: ['Restart Sim', 'Quit Sim'],
      defaultId: 0,
      cancelId: 1,
      message: 'Sim encountered a problem',
      detail: 'Restart Sim to recover. Diagnostic details were saved locally.',
    }
    const win = getWindow()
    const prompt =
      win && !win.isDestroyed()
        ? dialog.showMessageBox(win, options)
        : dialog.showMessageBox(options)
    void prompt
      .then(({ response }) => {
        if (response === 0) app.relaunch()
      })
      .catch(() => {})
      .finally(() => {
        app.exit(1)
      })
  }

  const onUnhandledRejection = (reason: unknown): void => {
    reportFatal('main_unhandled_rejection', reason)
  }
  const onUncaughtException = (error: Error): void => {
    reportFatal('main_uncaught_exception', error)
  }

  app.on('child-process-gone', onChildProcessGone)
  processSource.on('unhandledRejection', onUnhandledRejection)
  processSource.on('uncaughtException', onUncaughtException)

  return () => {
    app.removeListener('child-process-gone', onChildProcessGone)
    processSource.removeListener('unhandledRejection', onUnhandledRejection)
    processSource.removeListener('uncaughtException', onUncaughtException)
  }
}

/**
 * Reduces a URL to origin + path for logging. Query strings and fragments are
 * dropped so tokens, states, and signed parameters never reach the event log.
 */
export function scrubUrl(raw: string): string {
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

/**
 * Structured JSONL event log for the main process, answering "is this release
 * crashing?" and "did auto-update fail?" from a user machine. Rotates once at
 * maxBytes (current file becomes .1). Callers must pass pre-scrubbed data —
 * use scrubUrl for anything URL-shaped and never log tokens or cookies.
 */
export function createEventLog(dir: string, maxBytes: number = DEFAULT_MAX_BYTES): EventRecorder {
  const filePath = join(dir, 'desktop-events.log')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {}

  const rotateIfNeeded = () => {
    try {
      if (statSync(filePath).size > maxBytes) {
        renameSync(filePath, `${filePath}.1`)
      }
    } catch {}
  }

  return {
    filePath,
    record(name, data) {
      logger.info(`desktop event: ${name}`, data)
      try {
        rotateIfNeeded()
        const entry = { at: new Date().toISOString(), name, ...(data ? { data } : {}) }
        appendFileSync(filePath, `${JSON.stringify(entry)}\n`)
      } catch (error) {
        logger.warn('Failed to append desktop event', { error })
      }
    },
  }
}
