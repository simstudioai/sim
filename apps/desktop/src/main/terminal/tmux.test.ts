import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitRun,
  isDescendantOf,
  parseFormatLines,
  parseProcessParents,
  pollRun,
  type TmuxRunHandle,
} from '@/main/terminal/tmux'

/** The separator the format strings use; no tmux field can contain it. */
const F = '\u001f'

describe('parseFormatLines', () => {
  it('splits a line into its fields', () => {
    expect(parseFormatLines(`12345${F}/dev/ttys004${F}main\n`, 3)).toEqual([
      ['12345', '/dev/ttys004', 'main'],
    ])
  })

  it('keeps fields that contain spaces intact', () => {
    // Splitting on whitespace would shift every later field for a window named
    // "my project" or a path under "Application Support".
    const line = `main:1.0${F}my project${F}zsh${F}/Users/me/Application Support${F}1`
    expect(parseFormatLines(line, 5)).toEqual([
      ['main:1.0', 'my project', 'zsh', '/Users/me/Application Support', '1'],
    ])
  })

  it('ignores blank lines and trailing newlines', () => {
    expect(parseFormatLines(`a${F}b\n\n\n`, 2)).toEqual([['a', 'b']])
  })

  it('drops lines with the wrong field count rather than mis-assigning them', () => {
    expect(parseFormatLines(`a${F}b\nonly-one\n`, 2)).toEqual([['a', 'b']])
  })

  it('returns nothing for empty output', () => {
    expect(parseFormatLines('', 3)).toEqual([])
  })
})

describe('parseProcessParents', () => {
  it('reads pid and parent pid pairs', () => {
    const parents = parseProcessParents('  501   1\n  777 501\n')
    expect(parents.get(501)).toBe(1)
    expect(parents.get(777)).toBe(501)
  })

  it('skips lines that are not two numbers', () => {
    expect(parseProcessParents('header row\n  42 7\n').size).toBe(1)
  })
})

describe('isDescendantOf', () => {
  // A tmux client is usually a direct child of the shell, but an rc file that
  // execs through a wrapper can put another process in between.
  const parents = new Map([
    [100, 1],
    [200, 100],
    [300, 200],
    [900, 1],
  ])

  it('matches the process itself', () => {
    expect(isDescendantOf(100, 100, parents)).toBe(true)
  })

  it('matches a direct child', () => {
    expect(isDescendantOf(200, 100, parents)).toBe(true)
  })

  it('matches through an intermediate process', () => {
    expect(isDescendantOf(300, 100, parents)).toBe(true)
  })

  it('rejects an unrelated process', () => {
    expect(isDescendantOf(900, 100, parents)).toBe(false)
  })

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

  it('reports a command as unfinished until the status file exists', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'building...\n')

    expect(pollRun(handleIn(dir))).toEqual({ output: 'building...\n', exitCode: null, done: false })
  })

  it('reads the real exit code once the status file lands', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'boom\n')
    writeFileSync(join(dir, 'status'), '7')

    expect(pollRun(handleIn(dir))).toEqual({ output: 'boom\n', exitCode: 7, done: true })
  })

  it('treats a command that produced no output as finished, not missing', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'status'), '0')

    expect(pollRun(handleIn(dir))).toEqual({ output: '', exitCode: 0, done: true })
  })

  it('reports done with no code rather than NaN when the status is unreadable', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'status'), 'not-a-number')

    expect(pollRun(handleIn(dir))).toEqual({ output: '', exitCode: null, done: true })
  })

  it('returns as soon as a command finishes rather than waiting out the window', async () => {
    const dir = scratch()
    writeFileSync(join(dir, 'out'), 'done\n')
    writeFileSync(join(dir, 'status'), '0')

    const started = Date.now()
    const outcome = await awaitRun(handleIn(dir), 5_000)

    expect(outcome.done).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_000)
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
