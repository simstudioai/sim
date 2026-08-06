/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceResourceRef } from '@/lib/copilot/resources/types'
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
  it('trusts an explicit id even when the file list has not caught up', () => {
    expect(resolveWorkspaceResourceRef(ref({ id: 'wf_abc' }), [])).toEqual({
      type: 'file',
      id: 'wf_abc',
      title: 'notes.md',
    })
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
