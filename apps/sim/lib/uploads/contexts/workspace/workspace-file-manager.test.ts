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
    uploadedAt: new Date('2026-04-13T00:00:00.000Z'),
  }
}

describe('workspace file reference normalization', () => {
  it('normalizes canonical by-id VFS paths to the raw file id', () => {
    expect(normalizeWorkspaceFileReference(`files/by-id/${FILE_ID}/content`)).toBe(FILE_ID)
    expect(normalizeWorkspaceFileReference(`files/by-id/${FILE_ID}/meta.json`)).toBe(FILE_ID)
    expect(normalizeWorkspaceFileReference(`by-id/${FILE_ID}`)).toBe(FILE_ID)
    expect(normalizeWorkspaceFileReference(`recently-deleted/files/by-id/${FILE_ID}/content`)).toBe(
      FILE_ID
    )
  })

  it('finds files from canonical by-id content paths', () => {
    const files = [makeFileRecord()]

    expect(findWorkspaceFileRecord(files, `files/by-id/${FILE_ID}/content`)).toMatchObject({
      id: FILE_ID,
      name: 'the_last_cartographer_of_vael.md',
    })

    expect(findWorkspaceFileRecord(files, `by-id/${FILE_ID}`)).toMatchObject({
      id: FILE_ID,
      name: 'the_last_cartographer_of_vael.md',
    })
  })
})
