import { describe, expect, it } from 'vitest'
import {
  canRetrySandboxBuild,
  extractIssues,
  toSubmittedLines,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'

describe('sandbox build retry availability', () => {
  it('does not expose retry capability to read-only viewers', () => {
    expect(canRetrySandboxBuild({ canAdmin: false, isDirty: false, saving: false })).toBe(false)
  })
})

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
