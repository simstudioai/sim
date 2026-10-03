import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitRun,
  isDescendantOf,
  parseFormatLines,
  pollRun,
  type TmuxRunHandle,
} from '@/main/terminal/tmux'

/** The separator the format strings use; no tmux field can contain it. */
const F = '\u001f'

describe('parseFormatLines', () => {
  it('drops lines with the wrong field count rather than mis-assigning them', () => {
    expect(parseFormatLines(`a${F}b\nonly-one\n`, 2)).toEqual([['a', 'b']])
  })
})

describe('isDescendantOf', () => {
  // A tmux client is usually a direct child of the shell, but an rc file that
  // execs through a wrapper can put another process in between.
  const _parents = new Map([
    [100, 1],
    [200, 100],
    [300, 200],
    [900, 1],
  ])

  it('rejects rather than looping when the chain cycles', () => {
    const cyclic = new Map([
      [10, 20],
      [20, 10],
    ])
    expect(isDescendantOf(10, 999, cyclic)).toBe(false)
  })
})

describe('run status files', () => {
  const dirs: string[] = []

  const handleIn = (dir: string): TmuxRunHandle => ({
    window: '@1',
    outPath: join(dir, 'out'),
    statusPath: join(dir, 'status'),
    dispose: () => {},
  })

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tmux-run-test-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads the real exit code once the status file lands', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'boom\n')
    writeFileSync(join(dir, 'status'), '7')

    expect(pollRun(handleIn(dir))).toEqual({ output: 'boom\n', exitCode: 7, done: true })
  })

  it('reports done with no code rather than NaN when the status is unreadable', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'status'), 'not-a-number')

    expect(pollRun(handleIn(dir))).toEqual({ output: '', exitCode: null, done: true })
  })

  it('hands back a still-running command when the window elapses', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'still going\n')

    // The whole point of the status file over `tmux wait-for`: a command that
    // outlives the wait leaves a pollable state rather than a blocked waiter.
    const outcome = await awaitRun(handleIn(dir), 300)

    expect(outcome).toEqual({ output: 'still going\n', exitCode: null, done: false })
  })
})
