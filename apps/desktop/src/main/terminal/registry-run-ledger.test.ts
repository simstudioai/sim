import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

/**
 * Each recorded run's pane as tmux has it: running, stopped by Sim, already gone, or one tmux
 * cannot answer for. A pane not listed is running.
 */
const { panes } = vi.hoisted(() => ({
  panes: new Map<string, 'running' | 'stopped' | 'gone' | 'unknown'>(),
}))

vi.mock('@/main/terminal/tmux', async () => {
  const actual =
    await vi.importActual<typeof import('@/main/terminal/tmux')>('@/main/terminal/tmux')
  const state = (runId: string) => panes.get(runId) ?? 'running'
  return {
    ...actual,
    recordedRunState: async (run: { runId: string }) => {
      const pane = state(run.runId)
      return pane === 'running' ? 'ours' : pane === 'unknown' ? 'unknown' : 'gone'
    },
    stopRecordedRun: async (run: { runId: string }) => {
      if (state(run.runId) === 'unknown') return 'unknown'
      if (state(run.runId) === 'running') panes.set(run.runId, 'stopped')
      return 'gone'
    },
  }
})

import { TerminalRegistry } from '@/main/terminal/registry'
import { createRunLedger } from '@/main/terminal/run-ledger'

const dirs: string[] = []

function ledgerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-registry-ledger-'))
  dirs.push(dir)
  return join(dir, 'terminal-runs')
}

function run(runId: string, pane: string, delivered = false) {
  return { runId, pane, socket: '/tmp/tmux-501/default', callId: `call-${runId}`, delivered }
}

afterEach(() => {
  panes.clear()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('stopping recorded tmux runs', () => {
  it('forgets each run once nothing of it is left, and keeps one tmux could not answer for', async () => {
    const dir = ledgerDir()
    const previous = createRunLedger(dir)
    previous.record(run('stopped', '%1'))
    previous.record(run('unanswered', '%2'))
    panes.set('unanswered', 'unknown')
    // Signing out ends a run whose result the model has, too.
    const ledger = createRunLedger(dir)

    await new TerminalRegistry(undefined, undefined, ledger).stopAgentCommands()

    expect(ledger.list().map((record) => record.runId)).toEqual(['unanswered'])
  })

  it("at launch, leaves the same user's runs the model can come back to, and stops the rest", async () => {
    const dir = ledgerDir()
    const previous = createRunLedger(dir)
    previous.record(run('handed-back', '%1', true))
    previous.record(run('never-handed-back', '%2'))
    // Handed back, but the call's journal still shows no result: the model never got it.
    previous.record(run('lost-on-the-way', '%3', true))
    previous.record(run('handed-back-and-gone', '%4', true))
    panes.set('handed-back-and-gone', 'gone')
    const ledger = createRunLedger(dir)
    const unresolved = new Set(['call-lost-on-the-way'])

    await new TerminalRegistry(undefined, undefined, ledger).stopUncollectableRuns(unresolved)

    expect(Object.fromEntries(panes)).toEqual({
      'never-handed-back': 'stopped',
      'lost-on-the-way': 'stopped',
      'handed-back-and-gone': 'gone',
    })
    expect(ledger.list().map((record) => record.runId)).toEqual(['handed-back'])
  })

  it("at launch, stops the previous process's runs and none this one has started", async () => {
    const dir = ledgerDir()
    createRunLedger(dir).record(run('previous', '%1'))
    const ledger = createRunLedger(dir)
    ledger.record(run('current', '%2'))

    await new TerminalRegistry(undefined, undefined, ledger).stopRecordedRuns({ excludeLive: true })

    expect(ledger.list().map((record) => record.runId)).toEqual(['current'])
  })
})
