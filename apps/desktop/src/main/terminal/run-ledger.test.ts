import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRunLedger } from '@/main/terminal/run-ledger'

const dirs: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sim-run-ledger-'))
  dirs.push(dir)
  return join(dir, 'terminal-runs')
}

const RUN = { runId: 'run-1', pane: '%3', socket: '/tmp/tmux-501/default' }

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the tmux run ledger', () => {
  it('keeps a run recorded until it is forgotten, for the next process too', () => {
    const dir = scratch()
    createRunLedger(dir).record(RUN)

    const nextProcess = createRunLedger(dir)
    expect(nextProcess.list()).toEqual([RUN])

    nextProcess.forget(RUN.runId)
    expect(createRunLedger(dir).list()).toEqual([])
  })

  it("leaves out this process's own runs when asked", () => {
    const dir = scratch()
    createRunLedger(dir).record(RUN)
    const ledger = createRunLedger(dir)
    ledger.record({ ...RUN, runId: 'run-2', pane: '%4' })

    expect(ledger.list({ excludeLive: true })).toEqual([RUN])
    expect(ledger.list()).toHaveLength(2)
  })

  it('drops files nothing could act on safely', () => {
    const dir = scratch()
    const ledger = createRunLedger(dir)
    ledger.record(RUN)
    writeFileSync(join(dir, 'garbled.json'), '{not json')
    writeFileSync(join(dir, 'run-9.json'), JSON.stringify({ ...RUN, socket: 'relative.sock' }))
    // A record under another run's name could stop the wrong run.
    writeFileSync(join(dir, 'run-8.json'), JSON.stringify({ ...RUN, runId: 'run-7' }))

    expect(ledger.list()).toEqual([RUN])
    expect(readdirSync(dir)).toEqual(['run-1.json'])
  })

  it('cleans up after a write that never finished, keeping the saved record', () => {
    const dir = scratch()
    const ledger = createRunLedger(dir)
    ledger.record(RUN)
    writeFileSync(join(dir, 'run-2.json.4242.1.tmp'), '{"runId":"run-2","pa')

    expect(ledger.list()).toEqual([RUN])
    expect(readdirSync(dir)).toEqual(['run-1.json'])
  })

  it('keeps sweeping, and lets a call finish, when an entry cannot be removed', () => {
    const dir = scratch()
    const ledger = createRunLedger(dir)
    ledger.record(RUN)
    // Not a file, so removing it fails.
    mkdirSync(join(dir, 'run-3.json'))
    mkdirSync(join(dir, 'run-4.json'))

    expect(ledger.list()).toEqual([RUN])
    expect(() => ledger.forget('run-4')).not.toThrow()
  })

  it('reports a record it could not save, so the run is not started', () => {
    const dir = scratch()
    // A file where the directory should be: nothing can be saved under it.
    writeFileSync(join(dir, '..', 'blocked'), '')
    const ledger = createRunLedger(join(dir, '..', 'blocked'))

    expect(ledger.record(RUN)).toBe(false)
  })

  it('records nothing for a run tag that is not a plain id', () => {
    const dir = scratch()
    const ledger = createRunLedger(dir)
    ledger.record({ ...RUN, runId: '../escape' })

    expect(ledger.list()).toEqual([])
  })
})
