import { describe, expect, it } from 'vitest'
import {
  assertCurrentDraftRevision,
  assertRevisionSourcePolicy,
  CHILD_REVISION_FILES_REQUIRED_ERROR,
  DraftRevisionConflictError,
} from '@/lib/apps/revisions'

describe('assertCurrentDraftRevision', () => {
  it('accepts only the current requested and expected draft revision', () => {
    expect(() =>
      assertCurrentDraftRevision({
        currentDraftRevisionId: 'revision-1',
        revisionId: 'revision-1',
        expectedRevisionId: 'revision-1',
      })
    ).not.toThrow()
  })

  it('returns a typed conflict for stale build requests', () => {
    expect(() =>
      assertCurrentDraftRevision({
        currentDraftRevisionId: 'revision-2',
        revisionId: 'revision-1',
        expectedRevisionId: 'revision-1',
      })
    ).toThrow(DraftRevisionConflictError)

    try {
      assertCurrentDraftRevision({
        currentDraftRevisionId: null,
        revisionId: 'revision-1',
      })
    } catch (error) {
      expect(error).toMatchObject({
        code: 'DRAFT_REVISION_CONFLICT',
        status: 409,
      })
    }
  })
})

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
