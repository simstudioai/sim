import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

/** How each recorded run's pane answers when stopped: still tracked by tmux or not. */
const { panes } = vi.hoisted(() => ({
  panes: new Map<string, 'gone' | 'unknown'>(),
}))

vi.mock('@/main/terminal/tmux', async () => {
  const actual =
    await vi.importActual<typeof import('@/main/terminal/tmux')>('@/main/terminal/tmux')
  return {
    ...actual,
    stopRecordedRun: async (run: { runId: string }) => panes.get(run.runId) ?? 'gone',
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

function run(runId: string, pane: string) {
  return { runId, pane, socket: '/tmp/tmux-501/default' }
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
    const ledger = createRunLedger(dir)

    await new TerminalRegistry(undefined, undefined, ledger).stopAgentCommands()

    expect(ledger.list().map((record) => record.runId)).toEqual(['unanswered'])
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
