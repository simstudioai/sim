import { describe, expect, it } from 'vitest'
import {
  assertRevisionSourcePolicy,
  CHILD_REVISION_FILES_REQUIRED_ERROR,
} from '@/lib/apps/revisions'

describe('assertRevisionSourcePolicy', () => {
  it('allows template files only for the first revision', () => {
    expect(() =>
      assertRevisionSourcePolicy({
        files: undefined,
        currentDraftRevisionId: null,
      })
    ).not.toThrow()
  })

  it('rejects silent template fallback for child revisions', () => {
    expect(() =>
      assertRevisionSourcePolicy({
        files: undefined,
        currentDraftRevisionId: 'revision-1',
      })
    ).toThrow(CHILD_REVISION_FILES_REQUIRED_ERROR)
  })

  it('allows explicit source files for child revisions', () => {
    expect(() =>
      assertRevisionSourcePolicy({
        files: { 'src/App.tsx': 'export function App() { return null }' },
        currentDraftRevisionId: 'revision-1',
      })
    ).not.toThrow()
  })
})
