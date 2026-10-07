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

/** A recorded run, with the call it belongs to and whether that call's result went back. */
export interface RunRecord extends RecordedRun {
  /** The tool call that started the run, to match it against the executor's journal. */
  callId: string
  /**
   * True once the run's call handed back its result while the run went on (`running`, with its
   * pane): from then on the model can come back to the pane, so a restart must leave it be.
   */
  delivered: boolean
  /** A stop for everything (sign-out, Terminal off) could not confirm this run ended. */
  mustStop?: boolean
}

export interface RunLedger {
  /** Saves a run's record; false when it could not be saved, so the run must not start. */
  record(run: RunRecord): boolean
  /** Notes that the run's call has handed back its result, with the run still going. */
  markDelivered(runId: string): void
  /** Notes that the run must be stopped, whatever a later launch would otherwise decide. */
  markMustStop(runId: string): void
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
      typeof parsed.delivered === 'boolean' &&
      typeof parsed.socket === 'string' &&
      parsed.socket.startsWith('/')
    ) {
      return {
        runId: parsed.runId,
        pane: parsed.pane,
        socket: parsed.socket,
        callId: parsed.callId,
        delivered: parsed.delivered,
        ...(parsed.mustStop === true ? { mustStop: true } : {}),
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
  const pathFor = (runId: string) => join(dir, `${runId}.json`)

  /** Rewrites a saved record; `change` returns null to leave it as it is. */
  const update = (runId: string, change: (record: RunRecord) => RunRecord | null): void => {
    if (!RUN_ID.test(runId)) return
    let record: RunRecord | null = null
    try {
      record = parseRecord(readFileSync(pathFor(runId), 'utf8'))
    } catch {
      record = null
    }
    const changed = record ? change(record) : null
    if (!changed) return
    try {
      writeJsonFileAtomicallySync(pathFor(runId), changed)
    } catch (error) {
      logger.warn('Could not update a tmux run record', { error: getErrorMessage(error) })
    }
  }

  return {
    record(run) {
      if (!RUN_ID.test(run.runId)) return false
      try {
        writeJsonFileAtomicallySync(pathFor(run.runId), run)
        live.add(run.runId)
        return true
      } catch (error) {
        logger.warn('Could not record a tmux run', { error: getErrorMessage(error) })
        return false
      }
    },
    markDelivered(runId) {
      // Left undelivered, a restart stops the run: the conservative side.
      update(runId, (record) => (record.delivered ? null : { ...record, delivered: true }))
    },
    markMustStop(runId) {
      update(runId, (record) => (record.mustStop ? null : { ...record, mustStop: true }))
    },
    forget(runId) {
      live.delete(runId)
      if (RUN_ID.test(runId)) remove(pathFor(runId))
    },
    list(options = {}) {
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
        if (options.excludeLive && live.has(record.runId)) continue
        runs.push(record)
      }
      return runs
    },
  }
}
