import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

/**
 * Each recorded run's pane as tmux has it: running, dead after its command ended
 * (`remain-on-exit`), stopped by Sim, already gone, or one tmux cannot answer for. A pane not
 * listed is running.
 */
const { panes } = vi.hoisted(() => ({
  panes: new Map<string, 'running' | 'dead' | 'stopped' | 'gone' | 'unknown'>(),
}))

vi.mock('@/main/terminal/tmux', async () => {
  const actual =
    await vi.importActual<typeof import('@/main/terminal/tmux')>('@/main/terminal/tmux')
  const state = (runId: string) => panes.get(runId) ?? 'running'
  return {
    ...actual,
    recordedRunState: async (run: { runId: string }) => {
      const pane = state(run.runId)
      if (pane === 'running') return 'ours'
      if (pane === 'dead') return 'finished'
      return pane === 'unknown' ? 'unknown' : 'gone'
    },
    stopRecordedRun: async (run: { runId: string }) => {
      if (state(run.runId) === 'unknown') return 'unknown'
      if (state(run.runId) === 'running' || state(run.runId) === 'dead') {
        panes.set(run.runId, 'stopped')
      }
      return 'gone'
    },
  }
})

import { TerminalRegistry } from '@/main/terminal/registry'
import { createRunLedger, type RunState } from '@/main/terminal/run-ledger'

const dirs: string[] = []

function ledgerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-registry-ledger-'))
  dirs.push(dir)
  return join(dir, 'terminal-runs')
}

function run(runId: string, pane: string, state: RunState = 'started') {
  return { runId, pane, socket: '/tmp/tmux-501/default', callId: `call-${runId}`, state }
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
    // Sim took its result: the model has the pane.
    previous.record(run('handed-back', '%1', 'delivered'))
    previous.record(run('never-handed-back', '%2'))
    // Its result is in the journal, unacknowledged: recovery will hand the pane to the model.
    previous.record(run('on-its-way', '%3'))
    previous.record(run('handed-back-and-gone', '%4', 'delivered'))
    panes.set('handed-back-and-gone', 'gone')
    // Handed back, but its command has since ended: only its dead pane is left.
    previous.record(run('handed-back-and-done', '%5', 'delivered'))
    panes.set('handed-back-and-done', 'dead')
    const ledger = createRunLedger(dir)

    await new TerminalRegistry(undefined, undefined, ledger).stopUncollectableRuns(
      new Set(['call-on-its-way'])
    )

    expect(Object.fromEntries(panes)).toEqual({
      'never-handed-back': 'stopped',
      'handed-back-and-gone': 'gone',
      'handed-back-and-done': 'stopped',
    })
    expect(
      ledger
        .list()
        .map((record) => record.runId)
        .sort()
    ).toEqual(['handed-back', 'on-its-way'])
  })

  it('keeps meaning to stop a run a stop for everything could not confirm', async () => {
    const dir = ledgerDir()
    createRunLedger(dir).record(run('unconfirmed', '%1', 'delivered'))
    panes.set('unconfirmed', 'unknown')
    const ledger = createRunLedger(dir)
    // Sign-out could not confirm the run ended.
    await new TerminalRegistry(undefined, undefined, ledger).stopAgentCommands()
    panes.set('unconfirmed', 'running')

    // A later launch for the same user, with the journal cleared, still stops it.
    await new TerminalRegistry(undefined, undefined, ledger).stopUncollectableRuns(new Set())

    expect(panes.get('unconfirmed')).toBe('stopped')
    expect(ledger.list()).toEqual([])
  })

  it("stops only the run of a call whose result never reached the model, this process's or a previous one's", async () => {
    const dir = ledgerDir()
    createRunLedger(dir).record(run('previous', '%1'))
    const ledger = createRunLedger(dir)
    ledger.record(run('current', '%2'))
    ledger.record(run('other', '%3'))
    // Recorded as handed back: the model has its pane.
    ledger.record(run('handed-back', '%4', 'delivered'))
    const registry = new TerminalRegistry(undefined, undefined, ledger)

    await registry.stopUndeliveredRun('call-current')
    await registry.stopUndeliveredRun('call-previous')
    await registry.stopUndeliveredRun('call-handed-back')

    expect(panes.get('current')).toBe('stopped')
    expect(panes.get('previous')).toBe('stopped')
    expect(panes.get('other')).toBeUndefined()
    expect(panes.get('handed-back')).toBeUndefined()
    expect(
      ledger
        .list()
        .map((record) => record.runId)
        .sort()
    ).toEqual(['handed-back', 'other'])
  })

  it('notes the run of a call whose result reached the model as handed back', () => {
    const dir = ledgerDir()
    const ledger = createRunLedger(dir)
    ledger.record(run('watched', '%1'))
    ledger.record(run('other', '%2'))

    new TerminalRegistry(undefined, undefined, ledger).markRunDelivered('call-watched')

    expect(Object.fromEntries(ledger.list().map((record) => [record.runId, record.state]))).toEqual(
      { watched: 'delivered', other: 'started' }
    )
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
