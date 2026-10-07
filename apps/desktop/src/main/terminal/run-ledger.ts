/**
 * A durable record of the agent's tagged tmux runs, so a later process can still stop them.
 *
 * A tmux run outlives the app: quitting, crashing or signing out mid-teardown leaves its command
 * going in the user's tmux server, and the next launch would otherwise know nothing about it.
 * Each record names the run's tag, its pane and its tmux server's socket, and nothing else: no
 * command line and no output, since it lives outside the account's encrypted data. A record is
 * written once the pane is tagged and removed once the run has ended, its pane is gone, or Sim has
 * stopped it.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DesktopTerminalRunLedger')

/** One recorded run: what it takes to find its pane again, on the server it ran on. */
export interface RunRecord {
  /** The tag on the run's pane; only a pane carrying it is ever acted on. */
  runId: string
  pane: string
  /** The tmux server's socket, so a different server is never asked about this pane. */
  socket: string
}

export interface RunLedger {
  record(run: RunRecord): void
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
      typeof parsed.socket === 'string' &&
      parsed.socket.startsWith('/')
    ) {
      return { runId: parsed.runId, pane: parsed.pane, socket: parsed.socket }
    }
  } catch {
    // Unreadable: treated as no record below.
  }
  return null
}

export function createRunLedger(dir: string): RunLedger {
  /** Runs recorded by this process, still going as far as it knows. */
  const live = new Set<string>()
  const pathFor = (runId: string) => join(dir, `${runId}.json`)

  return {
    record(run) {
      if (!RUN_ID.test(run.runId)) return
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        writeFileSync(pathFor(run.runId), JSON.stringify(run), { mode: 0o600 })
        live.add(run.runId)
      } catch (error) {
        logger.warn('Could not record a tmux run', { error: getErrorMessage(error) })
      }
    },
    forget(runId) {
      live.delete(runId)
      if (!RUN_ID.test(runId)) return
      rmSync(pathFor(runId), { force: true })
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
        if (!name.endsWith('.json')) continue
        let record: RunRecord | null = null
        try {
          record = parseRecord(readFileSync(join(dir, name), 'utf8'))
        } catch {
          record = null
        }
        if (!record || `${record.runId}.json` !== name) {
          // Nothing could act on it safely; it only takes up space.
          rmSync(join(dir, name), { force: true })
          continue
        }
        if (options.excludeLive && live.has(record.runId)) continue
        runs.push(record)
      }
      return runs
    },
  }
}
