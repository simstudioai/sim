import { describe, expect, it } from 'vitest'
import {
  isWorkspaceResourceKind,
  workspaceResourcePath,
  workspaceResourceWebUrl,
} from '@/lib/resources'

describe('workspace resource URLs', () => {
  it.each([
    ['file', 'file-1', '/workspace/ws-1/files/file-1'],
    ['folder', 'folder-1', '/workspace/ws-1/files?folderId=folder-1'],
    ['knowledge', 'kb-1', '/workspace/ws-1/knowledge/kb-1'],
    ['skill', 'skill-1', '/workspace/ws-1/skills?skillId=skill-1'],
    ['table', 'table-1', '/workspace/ws-1/tables/table-1'],
    ['workflow', 'workflow-1', '/workspace/ws-1/w/workflow-1'],
  ] as const)('builds the canonical %s path', (kind, resourceId, expected) => {
    expect(workspaceResourcePath('ws-1', kind, resourceId)).toBe(expected)
  })

  it('encodes route parameters', () => {
    expect(workspaceResourcePath('workspace one', 'table', 'table/two')).toBe(
      '/workspace/workspace%20one/tables/table%2Ftwo'
    )
  })

  it('builds an absolute URL from the public app base URL', () => {
    expect(workspaceResourceWebUrl('https://app.example.com', 'ws-1', 'workflow', 'wf-1')).toBe(
      'https://app.example.com/workspace/ws-1/w/wf-1'
    )
  })

  it('recognizes only navigable resource kinds', () => {
    expect(isWorkspaceResourceKind('knowledge')).toBe(true)
    expect(isWorkspaceResourceKind('integration')).toBe(false)
  })
})
