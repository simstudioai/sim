import { describe, expect, it } from 'vitest'
import { annotationLine, inGithubActions } from './github-actions'

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

  it('emits nothing outside a GitHub Actions job, or with the switch turned off', () => {
    expect(inGithubActions({})).toBe(false)
    expect(inGithubActions({ GITHUB_ACTIONS: 'false' })).toBe(false)
    expect(inGithubActions({ GITHUB_ACTIONS: 'true' })).toBe(true)
  })
})
