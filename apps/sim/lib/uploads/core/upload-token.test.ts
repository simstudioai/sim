/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { signUploadToken, verifyUploadToken } from '@/lib/uploads/core/upload-token'

describe('upload token', () => {
  it('round-trips stateless multipart session state', () => {
    const token = signUploadToken({
      uploadId: 'upload-1',
      key: 'workspace-1/file.csv',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      context: 'workspace',
      fileName: 'file.csv',
      contentType: 'text/csv',
      fileSize: 12,
      purpose: 'workspace_file',
      provider: 's3',
      providerUploadId: 'provider-upload-1',
      partSize: 8,
      partCount: 2,
      metadata: { folderId: 'folder-1' },
      createdAt: '2026-08-03T20:00:00.000Z',
      expiresAt: '2026-08-04T20:00:00.000Z',
    })

    expect(verifyUploadToken(token)).toEqual({
      valid: true,
      payload: {
        uploadId: 'upload-1',
        key: 'workspace-1/file.csv',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        context: 'workspace',
        fileName: 'file.csv',
        contentType: 'text/csv',
        fileSize: 12,
        purpose: 'workspace_file',
        provider: 's3',
        providerUploadId: 'provider-upload-1',
        partSize: 8,
        partCount: 2,
        metadata: { folderId: 'folder-1' },
        createdAt: '2026-08-03T20:00:00.000Z',
        expiresAt: '2026-08-04T20:00:00.000Z',
      },
    })
  })

  it('rejects a modified token', () => {
    const token = signUploadToken({
      uploadId: 'upload-1',
      key: 'workspace-1/file.csv',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      context: 'workspace',
    })
    const [payload, signature] = token.split('.')

    expect(verifyUploadToken(`${payload}x.${signature}`)).toEqual({ valid: false })
  })
})
