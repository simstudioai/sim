/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildVfsFolderPathMap,
  canonicalBlockVfsPath,
  canonicalKnowledgeBaseVfsDir,
  canonicalTableVfsPath,
  canonicalWorkflowVfsDir,
  canonicalWorkspaceFilePath,
  chatScopedOrWorkspacePath,
  decodeVfsPathSegments,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'

describe('VFS path utilities', () => {
  it('round trips encoded nested path segments', () => {
    const segments = ['Reports', 'Q4 Report (Final)', 'sales/east.csv']

    const encoded = encodeVfsPathSegments(segments)

    expect(encoded).toBe('Reports/Q4%20Report%20(Final)/sales%2Feast.csv')
    expect(decodeVfsPathSegments(encoded)).toEqual(segments)
  })

  it('builds canonical workspace file leaf paths', () => {
    expect(
      canonicalWorkspaceFilePath({
        folderPath: 'Reports/Q4 Report (Final)',
        name: 'sales/east.csv',
      })
    ).toBe('files/Reports/Q4%20Report%20(Final)/sales%2Feast.csv')
  })
})

describe('canonical resource VFS paths', () => {
  it('builds nested + encoded folder path map', () => {
    const map = buildVfsFolderPathMap([
      { folderId: 'root', folderName: 'My Folder', parentId: null },
      { folderId: 'child', folderName: 'Sub Folder', parentId: 'root' },
    ])
    expect(map.get('root')).toBe('My%20Folder')
    expect(map.get('child')).toBe('My%20Folder/Sub%20Folder')
  })

  it('builds workflow dirs at root and nested in folders', () => {
    expect(canonicalWorkflowVfsDir({ name: 'My Flow' })).toBe('workflows/My%20Flow')
    expect(
      canonicalWorkflowVfsDir({ name: 'My Flow', folderPath: 'My%20Folder/Sub%20Folder' })
    ).toBe('workflows/My%20Folder/Sub%20Folder/My%20Flow')
  })

  it('builds table, knowledge base, and block pointers', () => {
    expect(canonicalTableVfsPath('Sales Data')).toBe('tables/Sales%20Data/meta.json')
    expect(canonicalKnowledgeBaseVfsDir('Docs — KB')).toBe('knowledgebases/Docs%20%E2%80%94%20KB')
    expect(canonicalBlockVfsPath('agent')).toBe('components/blocks/agent.json')
  })
})

describe('chatScopedOrWorkspacePath', () => {
  it('routes chat-scoped records to their flat encoded namespace', () => {
    expect(chatScopedOrWorkspacePath({ storageContext: 'output', name: 'chart 1.png' })).toBe(
      'outputs/chart%201.png'
    )
    expect(chatScopedOrWorkspacePath({ storageContext: 'mothership', name: 'photo.jpg' })).toBe(
      'uploads/photo.jpg'
    )
  })

  it('routes workspace records (and legacy records without storageContext) to files/', () => {
    expect(
      chatScopedOrWorkspacePath({
        storageContext: 'workspace',
        folderPath: 'Q4 Docs',
        name: 'report.pdf',
      })
    ).toBe('files/Q4%20Docs/report.pdf')
    expect(chatScopedOrWorkspacePath({ name: 'report.pdf' })).toBe('files/report.pdf')
  })
})
