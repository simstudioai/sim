/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { signUploadToken, verifyUploadToken } from '@/lib/uploads/core/upload-token'

const TIMESTAMPS = {
  createdAt: '2099-08-03T20:00:00.000Z',
  expiresAt: '2099-08-04T20:00:00.000Z',
} as const

describe('upload token', () => {
  it('round-trips strict multipart session state', () => {
    const payload = {
      uploadId: 'upload-1',
      actorId: 'user-1',
      workspaceId: 'workspace-1',
      purpose: 'knowledge_document',
      knowledgeBaseId: 'kb-1',
      context: 'knowledge-base',
      finalKey: 'kb/final-file.csv',
      stagingKey: 'upload-sessions/upload-1/file.csv',
      provider: 's3',
      providerUploadId: 'provider-upload-1',
      method: 'multipart',
      fileName: 'file.csv',
      contentType: 'text/csv',
      fileSize: 12,
      partSize: 8,
      partCount: 2,
      metadata: { tag1: 'product' },
      ...TIMESTAMPS,
    } as const
    const token = signUploadToken(payload)

    expect(verifyUploadToken(token)).toEqual({ valid: true, payload })
  })

  it('round-trips a user-scoped PUT without a synthetic workspace', () => {
    const payload = {
      uploadId: 'upload-2',
      actorId: 'user-1',
      workspaceId: null,
      purpose: 'profile_picture',
      context: 'profile-pictures',
      finalKey: 'profile-pictures/upload-2-avatar.png',
      stagingKey: 'upload-sessions/upload-2/avatar.png',
      provider: 'local',
      providerUploadId: null,
      method: 'put',
      fileName: 'avatar.png',
      contentType: 'image/png',
      fileSize: 12,
      metadata: {},
      ...TIMESTAMPS,
    } as const

    expect(verifyUploadToken(signUploadToken(payload))).toEqual({ valid: true, payload })
  })

  it('round-trips an empty workspace-file PUT', () => {
    const payload = {
      uploadId: 'upload-empty',
      actorId: 'user-1',
      workspaceId: 'workspace-1',
      purpose: 'workspace_file',
      context: 'workspace',
      finalKey: 'workspace/workspace-1/empty.md',
      stagingKey: 'upload-sessions/upload-empty/empty.md',
      provider: 'local',
      providerUploadId: null,
      method: 'put',
      fileName: 'empty.md',
      contentType: 'text/markdown',
      fileSize: 0,
      metadata: {},
      ...TIMESTAMPS,
    } as const

    expect(verifyUploadToken(signUploadToken(payload))).toEqual({ valid: true, payload })
  })

  it('rejects an empty PUT for non-workspace-file purposes', () => {
    expect(() =>
      signUploadToken({
        uploadId: 'upload-empty',
        actorId: 'user-1',
        workspaceId: null,
        purpose: 'profile_picture',
        context: 'profile-pictures',
        finalKey: 'profile-pictures/empty.png',
        stagingKey: 'upload-sessions/upload-empty/empty.png',
        provider: 'local',
        providerUploadId: null,
        method: 'put',
        fileName: 'empty.png',
        contentType: 'image/png',
        fileSize: 0,
        metadata: {},
        ...TIMESTAMPS,
      })
    ).toThrow('Upload token payload has invalid object state')
  })

  it('rejects a modified token', () => {
    const token = signUploadToken({
      uploadId: 'upload-1',
      actorId: 'user-1',
      workspaceId: 'workspace-1',
      purpose: 'workspace_file',
      context: 'workspace',
      finalKey: 'workspace/workspace-1/final.csv',
      stagingKey: 'upload-sessions/upload-1/file.csv',
      provider: 'local',
      providerUploadId: null,
      method: 'put',
      fileName: 'file.csv',
      contentType: 'text/csv',
      fileSize: 12,
      metadata: {},
      ...TIMESTAMPS,
    })
    const [payload, signature] = token.split('.')

    expect(verifyUploadToken(`${payload}x.${signature}`)).toEqual({ valid: false })
  })
})
