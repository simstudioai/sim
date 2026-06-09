/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  findWorkspaceFileRecord,
  normalizeWorkspaceFileReference,
  type WorkspaceFileRecord,
} from './workspace-file-manager'

const FILE_ID = 'ec28e5d5-898a-48f0-aa6f-2fd7427c9563'

function makeFileRecord(): WorkspaceFileRecord {
  return {
    id: FILE_ID,
    workspaceId: 'ws_123',
    name: 'the_last_cartographer_of_vael.md',
    key: 'workspace/ws_123/mock-key',
    path: '/api/files/serve/mock-key?context=workspace',
    size: 128,
    type: 'text/markdown',
    uploadedBy: 'user_123',
    folderId: null,
    folderPath: null,
    uploadedAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
  }
}

describe('workspace file reference normalization', () => {
  it('normalizes canonical VFS paths to their sanitized display path', () => {
    expect(normalizeWorkspaceFileReference('files/Reports/q1.csv/content')).toBe('Reports/q1.csv')
    expect(normalizeWorkspaceFileReference('files/Reports/q1.csv/meta.json')).toBe('Reports/q1.csv')
    expect(normalizeWorkspaceFileReference('recently-deleted/files/data.csv/content')).toBe(
      'data.csv'
    )
  })

  it('still resolves a raw file id passed directly', () => {
    const files = [makeFileRecord()]

    expect(findWorkspaceFileRecord(files, FILE_ID)).toMatchObject({
      id: FILE_ID,
      name: 'the_last_cartographer_of_vael.md',
    })
  })

  it('does not resolve id-based VFS paths', () => {
    const files = [makeFileRecord()]

    expect(findWorkspaceFileRecord(files, `files/by-id/${FILE_ID}/content`)).toBeNull()
  })

  it('resolves duplicate names by folder-aware VFS path', () => {
    const reportsFile: WorkspaceFileRecord = {
      ...makeFileRecord(),
      id: 'file-reports',
      name: 'q1.csv',
      folderId: 'folder-reports',
      folderPath: 'Reports',
    }
    const archiveFile: WorkspaceFileRecord = {
      ...makeFileRecord(),
      id: 'file-archive',
      name: 'q1.csv',
      folderId: 'folder-archive',
      folderPath: 'Archive',
    }

    expect(
      findWorkspaceFileRecord([reportsFile, archiveFile], 'files/Reports/q1.csv/content')
    ).toBe(reportsFile)
    expect(findWorkspaceFileRecord([reportsFile, archiveFile], 'files/Archive/q1.csv')).toBe(
      archiveFile
    )
  })
})
