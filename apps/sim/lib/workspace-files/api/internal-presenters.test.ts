/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { internalFilePresenters } from '@/lib/workspace-files/api/internal-presenters'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'

const file: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'test.txt',
  key: 'workspace/test.txt',
  path: 'test.txt',
  size: 10,
  type: 'text/plain',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  contentUpdatedAt: new Date('2026-01-01'),
}

describe('workspace file metadata revisions', () => {
  it('publishes a token for the content timestamp rather than a metadata edit', () => {
    expect(internalFilePresenters.successFile({ file }).file.revision).toBe(
      workspaceFileRevision(file)
    )
  })
  it('omits the token when no content timestamp exists', () => {
    expect(
      internalFilePresenters.successFile({ file: { ...file, contentUpdatedAt: null } }).file
    ).not.toHaveProperty('revision')
  })
})
