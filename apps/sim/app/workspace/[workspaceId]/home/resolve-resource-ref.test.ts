/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceResourceRef } from '@/lib/mothership/resources/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { resolveWorkspaceResourceRef } from './resolve-resource-ref'

function file(overrides: Partial<WorkspaceFileRecord> & { id: string; name: string }) {
  return {
    workspaceId: 'ws-1',
    key: `k/${overrides.id}`,
    path: `/api/files/serve/${overrides.id}`,
    size: 1,
    type: 'text/plain',
    uploadedBy: 'user-1',
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as WorkspaceFileRecord
}

function ref(overrides: Partial<WorkspaceResourceRef> = {}): WorkspaceResourceRef {
  return { type: 'file', title: 'notes.md', ...overrides }
}

describe('resolveWorkspaceResourceRef', () => {
  it('resolves an explicit id against the known files', () => {
    const files = [file({ id: 'wf_abc', name: 'notes.md' })]
    expect(resolveWorkspaceResourceRef(ref({ id: 'wf_abc' }), files)).toEqual({
      type: 'file',
      id: 'wf_abc',
      title: 'notes.md',
      path: 'files/notes.md',
    })
  })

  it('refuses an id no file answers to, rather than opening a tab pointing at nothing', () => {
    expect(resolveWorkspaceResourceRef(ref({ id: 'wf_gone' }), [])).toBeNull()
  })

  it('resolves a path against the known files', () => {
    const files = [file({ id: 'wf_abc', name: 'notes.md', folderPath: 'docs' })]
    expect(resolveWorkspaceResourceRef(ref({ path: 'files/docs/notes.md' }), files)).toEqual({
      type: 'file',
      id: 'wf_abc',
      title: 'notes.md',
      path: 'files/docs/notes.md',
    })
  })

  it('resolves a bare filename handed over as a path', () => {
    // A rendered link collapses id and path into one value, and the agent may
    // write a bare name into `path` — neither may be taken at face value.
    const files = [file({ id: 'wf_abc', name: 'notes.md', folderPath: 'docs' })]
    expect(resolveWorkspaceResourceRef(ref({ path: 'notes.md' }), files)?.id).toBe('wf_abc')
  })

  it('resolves an id handed over as a path', () => {
    const files = [file({ id: 'wf_abc', name: 'notes.md' })]
    expect(resolveWorkspaceResourceRef(ref({ path: 'wf_abc' }), files)?.id).toBe('wf_abc')
  })

  it('resolves a title when exactly one file answers to it', () => {
    const files = [file({ id: 'wf_abc', name: 'notes.md' }), file({ id: 'wf_x', name: 'other.md' })]
    expect(resolveWorkspaceResourceRef(ref(), files)?.id).toBe('wf_abc')
  })

  it('refuses an ambiguous title rather than opening the wrong file', () => {
    const files = [
      file({ id: 'wf_a', name: 'notes.md', folderPath: 'a' }),
      file({ id: 'wf_b', name: 'notes.md', folderPath: 'b' }),
    ]
    expect(resolveWorkspaceResourceRef(ref(), files)).toBeNull()
  })

  it('refuses a file it cannot identify, instead of inventing an empty id', () => {
    expect(resolveWorkspaceResourceRef(ref(), [])).toBeNull()
    expect(resolveWorkspaceResourceRef(ref({ path: 'files/gone.md' }), [])).toBeNull()
  })

  it('never resolves a non-file resource without an id', () => {
    expect(resolveWorkspaceResourceRef(ref({ type: 'table', title: 'Sales' }), [])).toBeNull()
    expect(
      resolveWorkspaceResourceRef(ref({ type: 'table', title: 'Sales', id: 't1' }), [])
    ).toEqual({ type: 'table', id: 't1', title: 'Sales' })
  })

  it('only ever returns resources that can be addressed', () => {
    const cases: WorkspaceResourceRef[] = [
      ref(),
      ref({ id: '' }),
      ref({ path: '' }),
      ref({ title: '' }),
      ref({ type: 'workflow', title: '' }),
    ]
    for (const candidate of cases) {
      const resolved = resolveWorkspaceResourceRef(candidate, [])
      expect(resolved === null || resolved.id.trim().length > 0).toBe(true)
    }
  })
})
