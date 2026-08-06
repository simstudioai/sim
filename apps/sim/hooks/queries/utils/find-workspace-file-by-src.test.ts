/**
 * @vitest-environment node
 */
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
  it('matches a serve URL by storage key', () => {
    expect(findWorkspaceFileBySrc(records, serveUrl('workspace/ws1/b.png'))?.id).toBe('wf_b')
  })

  it('matches a /api/files/view/<id> URL by file id', () => {
    expect(findWorkspaceFileBySrc(records, '/api/files/view/wf_a')?.id).toBe('wf_a')
  })

  it('matches a /workspace/<ws>/files/<id> URL by file id', () => {
    expect(findWorkspaceFileBySrc(records, '/workspace/ws1/files/wf_b')?.id).toBe('wf_b')
  })

  it('returns undefined for a serve URL whose key is not in the list', () => {
    expect(findWorkspaceFileBySrc(records, serveUrl('workspace/ws1/missing.png'))).toBeUndefined()
  })

  it('returns undefined for external, data:, and undefined srcs', () => {
    expect(findWorkspaceFileBySrc(records, 'https://example.com/x.png')).toBeUndefined()
    expect(findWorkspaceFileBySrc(records, 'data:image/png;base64,AAAA')).toBeUndefined()
    expect(findWorkspaceFileBySrc(records, undefined)).toBeUndefined()
  })

  it('returns undefined when the file list has not loaded yet', () => {
    expect(findWorkspaceFileBySrc(undefined, '/api/files/view/wf_a')).toBeUndefined()
  })
})
