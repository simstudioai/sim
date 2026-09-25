import { describe, expect, it } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { findWorkspaceFileBySrc } from '@/hooks/queries/utils/find-workspace-file-by-src'

function record(over: Partial<WorkspaceFileRecord>): WorkspaceFileRecord {
  return { id: 'wf_x', key: 'workspace/ws1/x.png', ...over } as WorkspaceFileRecord
}

const records = [
  record({ id: 'wf_a', key: 'workspace/ws1/a.png' }),
  record({ id: 'wf_b', key: 'workspace/ws1/b.png' }),
]

const serveUrl = (key: string) => `/api/files/serve/${encodeURIComponent(key)}?context=workspace`

describe('findWorkspaceFileBySrc', () => {
  it('returns undefined for a serve URL whose key is not in the list', () => {
    expect(findWorkspaceFileBySrc(records, serveUrl('workspace/ws1/missing.png'))).toBeUndefined()
  })

  it('returns undefined for external, data:, and undefined srcs', () => {
    expect(findWorkspaceFileBySrc(records, 'https://example.com/x.png')).toBeUndefined()
    expect(findWorkspaceFileBySrc(records, 'data:image/png;base64,AAAA')).toBeUndefined()
    expect(findWorkspaceFileBySrc(records, undefined)).toBeUndefined()
  })
})
