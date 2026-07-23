import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'

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
  | 'session_expired'
  | 'sign_out'
  | 'origin_changed'
  | 'handoff_started'
  | 'connect_handoff_started'
  | 'connect_handoff_open_fail'
  | 'connect_handoff_state_fail'
  | 'connect_handoff_ok'
  | 'connect_handoff_error'
  | 'launcher_load_failed'

export interface EventRecorder {
  readonly filePath: string
  record(name: DesktopEventName, data?: Record<string, string | number | boolean>): void
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
