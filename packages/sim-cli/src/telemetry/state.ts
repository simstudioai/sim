import { generateId } from '@sim/utils/id'
import { readJsonFile, writeJsonFile } from '../config/json-file'
import { telemetryStatePath } from '../config/paths'

/**
 * Two commands closer together than this belong to one session, the way the
 * Vercel and Supabase CLIs group them. Far above a person's pause between
 * commands and far below a lunch break, so a session reads as one sitting.
 */
export const SESSION_IDLE_MS = 30 * 60 * 1000

/** Far above the few-hundred-byte document while still bounding hostile files. */
const MAX_STATE_BYTES = 4 * 1024

const STATE_VERSION = 1

/** The state file is not secret, but it identifies the device, so it is the user's alone. */
const STATE_FILE_MODE = 0o600

export interface TelemetrySession {
  id: string
  /** When the last command in this session ran, for the idle cutoff. */
  lastActiveAt: string
  /** Commands recorded in this session so far; the next one is `sequence + 1`. */
  sequence: number
}

export interface TelemetryState {
  /** Unknown versions are treated as absent. */
  version: typeof STATE_VERSION
  /**
   * A random id for this installation, minted the first time telemetry runs.
   * It ties one device's commands together and nothing else: it is not derived
   * from hardware, the account, or the network.
   */
  deviceId: string
  /** `false` after `sim telemetry disable`; absent or `true` otherwise. */
  enabled?: boolean
  /** When the first-run notice was printed; absent until it has been. */
  noticeShownAt?: string
  session?: TelemetrySession
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function parseSession(value: unknown): TelemetrySession | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const session = value as Partial<TelemetrySession>
  if (typeof session.id !== 'string' || !session.id) return undefined
  if (!isIsoTimestamp(session.lastActiveAt)) return undefined
  if (!Number.isSafeInteger(session.sequence) || (session.sequence as number) < 0) return undefined
  return {
    id: session.id,
    lastActiveAt: session.lastActiveAt,
    sequence: session.sequence as number,
  }
}

/** A fresh state for an installation telemetry has never seen. Not written until something changes. */
function initialTelemetryState(): TelemetryState {
  return { version: STATE_VERSION, deviceId: generateId() }
}

/**
 * The persisted state, or `null` when there is none worth trusting.
 *
 * Validated field by field: the file is the user's to edit or corrupt, and a
 * document that fails validation is replaced rather than repaired, so a bad
 * `deviceId` never leaks into an event.
 */
export function readTelemetryState(path = telemetryStatePath()): TelemetryState | null {
  const parsed = readJsonFile(path, MAX_STATE_BYTES)
  if (typeof parsed !== 'object' || parsed === null) return null
  const state = parsed as Partial<TelemetryState>
  if (state.version !== STATE_VERSION) return null
  if (typeof state.deviceId !== 'string' || !state.deviceId) return null

  const result: TelemetryState = { version: STATE_VERSION, deviceId: state.deviceId }
  if (typeof state.enabled === 'boolean') result.enabled = state.enabled
  if (isIsoTimestamp(state.noticeShownAt)) result.noticeShownAt = state.noticeShownAt
  const session = parseSession(state.session)
  if (session) result.session = session
  return result
}

/** The persisted state, or a fresh one when there is none. */
export function loadTelemetryState(path = telemetryStatePath()): TelemetryState {
  return readTelemetryState(path) ?? initialTelemetryState()
}

export function writeTelemetryState(state: TelemetryState, path = telemetryStatePath()): void {
  writeJsonFile(path, state, STATE_FILE_MODE)
}

/**
 * The session the next command belongs to: the current one, advanced by one,
 * when it was active within {@link SESSION_IDLE_MS}; otherwise a new one. A
 * clock that moved backwards reads as idle, which only starts a new session.
 */
export function nextSession(state: TelemetryState, now: Date): TelemetrySession {
  const current = state.session
  const idleFor = current ? now.getTime() - Date.parse(current.lastActiveAt) : Number.NaN
  if (current && idleFor >= 0 && idleFor < SESSION_IDLE_MS) {
    return { id: current.id, lastActiveAt: now.toISOString(), sequence: current.sequence + 1 }
  }
  return { id: generateId(), lastActiveAt: now.toISOString(), sequence: 1 }
}
