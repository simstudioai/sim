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
  it('refuses an id no file answers to, rather than opening a tab pointing at nothing', () => {
    expect(resolveWorkspaceResourceRef(ref({ id: 'wf_gone' }), [])).toBeNull()
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
