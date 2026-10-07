/**
 * A durable record of the agent's tagged tmux runs, so a later process can still stop them.
 *
 * A tmux run outlives the app: quitting, crashing or signing out mid-teardown leaves its command
 * going in the user's tmux server, and the next launch would otherwise know nothing about it.
 * Each record names the run's tag, its pane and its tmux server's socket, and nothing else: no
 * command line and no output, since it lives outside the account's encrypted data. A record is
 * saved before the run's command may start, and removed once the run has ended, its pane is gone,
 * or Sim has stopped it.
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { writeJsonFileAtomicallySync } from '@/main/atomic-json-file'
import type { RecordedRun } from '@/main/terminal/tmux'

const logger = createLogger('DesktopTerminalRunLedger')

/**
 * Where a recorded run stands, moving only forward:
 * - `started`: its call has not handed its result to the model;
 * - `delivered`: the model has the result that handed the run back as still going (with its
 *   pane), so a restart must leave the run be;
 * - `stop`: a stop for everything (sign-out, Terminal off) could not confirm the run ended, so
 *   it is stopped whatever comes after, a late `delivered` included.
 */
export type RunState = 'started' | 'delivered' | 'stop'

const RUN_STATES: readonly RunState[] = ['started', 'delivered', 'stop']

/** A recorded run, with the call it belongs to and where it stands. */
export interface RunRecord extends RecordedRun {
  /** The tool call that started the run, to match it against the executor's journal. */
  callId: string
  state: RunState
}

export interface RunLedger {
  /** Saves a run's record; false when it could not be saved, so the run must not start. */
  record(run: RunRecord): boolean
  /** Moves a run forward to `state`; a run already there or past it stays as it is. */
  advance(runId: string, state: RunState): void
  /** The recorded run a tool call started, if the ledger still holds one. */
  runOf(callId: string): string | undefined
  forget(runId: string): void
  /** Every recorded run; `excludeLive` leaves out runs this process recorded. */
  list(options?: { excludeLive?: boolean }): RunRecord[]
}

/** Run tags are generated ids; anything else in the directory is not a record. */
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/

function parseRecord(text: string): RunRecord | null {
  try {
    const parsed = JSON.parse(text) as Partial<RunRecord>
    if (
      typeof parsed.runId === 'string' &&
      RUN_ID.test(parsed.runId) &&
      typeof parsed.pane === 'string' &&
      /^%\d+$/.test(parsed.pane) &&
      typeof parsed.callId === 'string' &&
      RUN_STATES.includes(parsed.state as RunState) &&
      typeof parsed.socket === 'string' &&
      parsed.socket.startsWith('/')
    ) {
      return {
        runId: parsed.runId,
        pane: parsed.pane,
        socket: parsed.socket,
        callId: parsed.callId,
        state: parsed.state as RunState,
      }
    }
  } catch {
    // Unreadable: treated as no record below.
  }
  return null
}

/** Removes a file the ledger no longer needs; a failure is logged, never thrown at a caller. */
function remove(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch (error) {
    logger.warn('Could not remove a tmux run record', { error: getErrorMessage(error) })
  }
}

export function createRunLedger(dir: string): RunLedger {
  /** Runs recorded by this process, still going as far as it knows. */
  const live = new Set<string>()
  /** Each recorded run by the call that started it: read from the directory once, then kept. */
  let byCall: Map<string, string> | null = null
  const pathFor = (runId: string) => join(dir, `${runId}.json`)

  /** Every saved record; anything else in the directory is removed. */
  const readAll = (): RunRecord[] => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    const runs: RunRecord[] = []
    for (const name of names) {
      // A write that never finished leaves only its temporary file behind.
      if (name.endsWith('.tmp')) {
        remove(join(dir, name))
        continue
      }
      if (!name.endsWith('.json')) continue
      let record: RunRecord | null = null
      try {
        record = parseRecord(readFileSync(join(dir, name), 'utf8'))
      } catch {
        record = null
      }
      if (!record || `${record.runId}.json` !== name) {
        // Nothing could act on it safely; it only takes up space.
        remove(join(dir, name))
        continue
      }
      runs.push(record)
    }
    return runs
  }

  const index = (): Map<string, string> => {
    byCall ??= new Map(readAll().map((run) => [run.callId, run.runId]))
    return byCall
  }

  return {
    record(run) {
      if (!RUN_ID.test(run.runId)) return false
      try {
        writeJsonFileAtomicallySync(pathFor(run.runId), run)
        live.add(run.runId)
        index().set(run.callId, run.runId)
        return true
      } catch (error) {
        logger.warn('Could not record a tmux run', { error: getErrorMessage(error) })
        return false
      }
    },
    advance(runId, state) {
      if (!RUN_ID.test(runId)) return
      let record: RunRecord | null = null
      try {
        record = parseRecord(readFileSync(pathFor(runId), 'utf8'))
      } catch {
        record = null
      }
      if (!record || RUN_STATES.indexOf(state) <= RUN_STATES.indexOf(record.state)) return
      try {
        writeJsonFileAtomicallySync(pathFor(runId), { ...record, state })
      } catch (error) {
        // Left behind, a restart stops the run: the conservative side.
        logger.warn('Could not update a tmux run record', { error: getErrorMessage(error) })
      }
    },
    runOf(callId) {
      return index().get(callId)
    },
    forget(runId) {
      live.delete(runId)
      for (const [callId, indexed] of byCall ?? []) if (indexed === runId) byCall?.delete(callId)
      if (RUN_ID.test(runId)) remove(pathFor(runId))
    },
    list(options = {}) {
      const runs = readAll()
      return options.excludeLive ? runs.filter((run) => !live.has(run.runId)) : runs
    },
  }
}
