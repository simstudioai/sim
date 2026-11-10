import { describe, expect, it } from 'vitest'
import { extractIssues, toSubmittedLines } from '@/components/settings/sections/sandboxes/utils'

describe('toSubmittedLines', () => {
  it('keeps blank rows so a rejection can address the line the user typed on', () => {
    expect(toSubmittedLines('axios\n\nzod')).toEqual(['axios', '', 'zod'])
  })
})

describe('extractIssues', () => {
  it('routes system-package rejections to the system-package field', () => {
    const error = {
      body: {
        issueField: 'systemPackages',
        issues: [{ line: 2, value: 'Nope', reason: 'not a package name' }],
      },
    }
    expect(extractIssues(error)).toEqual({
      field: 'systemPackages',
      issues: [{ line: 2, value: 'Nope', reason: 'not a package name' }],
    })
  })
})
