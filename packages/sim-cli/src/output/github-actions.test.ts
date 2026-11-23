import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { embedStore } from '../embed-context'
import { annotationLine, annotationPath, publishSummary } from './github-actions'

describe('GitHub Actions workflow commands', () => {
  it('escapes a message and its properties as the runner unescapes them', () => {
    expect(
      annotationLine('error', '100% wrong\nsecond line', {
        file: 'workflows/a,b/workflow.ts',
        line: 3,
        column: 9,
        title: 'E_X: y',
      })
    ).toBe(
      '::error file=workflows/a%2Cb/workflow.ts,line=3,col=9,title=E_X%3A y::100%25 wrong%0Asecond line'
    )
  })

  it('points an annotation at its path from the repository root, whatever directory the step runs in', () => {
    const env = { GITHUB_WORKSPACE: '/home/runner/work/repo/repo' }

    expect(
      annotationPath('/home/runner/work/repo/repo/workspace', 'workflows/ingest/workflow.ts', env)
    ).toBe('workspace/workflows/ingest/workflow.ts')
    expect(annotationPath('/tmp/elsewhere', 'workflows/ingest/workflow.ts', env)).toBe(
      '/tmp/elsewhere/workflows/ingest/workflow.ts'
    )
  })
})

describe('summaries', () => {
  const dirs: string[] = []
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-summary-'))
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('appends to the step summary on GitHub Actions and replaces the summary file anywhere', () => {
    const dir = scratch()
    const step = join(dir, 'step.md')
    const file = join(dir, 'plan.md')
    const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: step }

    publishSummary(() => 'one', { file, marker: '<!-- m -->', env })
    publishSummary(() => 'two', { file, marker: '<!-- m -->', env })

    expect(readFileSync(step, 'utf8')).toBe('one\n\ntwo\n\n')
    expect(readFileSync(file, 'utf8')).toBe('<!-- m -->\ntwo\n')
  })

  it('builds nothing when no summary is asked for', () => {
    publishSummary(
      () => {
        throw new Error('built')
      },
      { env: {} }
    )
  })

  it('reports a summary it cannot build and writes nothing, leaving the command to finish', () => {
    const file = join(scratch(), 'plan.md')

    expect(() =>
      publishSummary(
        () => {
          throw new Error('bad plan')
        },
        { file, env: {} }
      )
    ).not.toThrow()
    expect(existsSync(file)).toBe(false)
  })

  it('writes no file inside an embedded host, whatever flags it was handed', () => {
    const file = join(scratch(), 'plan.md')

    embedStore.run({} as never, () => publishSummary(() => 'plan', { file, env: {} }))

    expect(existsSync(file)).toBe(false)
  })
})
