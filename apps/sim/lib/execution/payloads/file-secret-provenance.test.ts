/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { metadata, readWorkspaceFile } = vi.hoisted(() => ({
  metadata: vi.fn(),
  readWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/uploads/server/metadata', () => ({ getFileMetadataByKey: metadata }))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content-by-key', () => ({
  readWorkspaceFileRecordByKey: { execute: readWorkspaceFile },
}))

import { resolveStoredFileProvenanceSource } from '@/lib/execution/payloads/file-secret-provenance'

const context = {
  principal: { kind: 'session', userId: 'reader', sessionId: 'session' } as const,
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
}
const file = {
  key: 'execution/workspace-1/workflow-1/execution-1/unique/archive.zip',
  context: 'execution' as const,
}
const revision = new Date('2026-09-11T00:00:00.000Z')
const record = {
  id: 'canonical-file',
  key: file.key,
  context: 'execution',
  workspaceId: context.workspaceId,
  userId: 'writer',
  contentUpdatedAt: revision,
}

describe('stored file provenance source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    metadata.mockResolvedValue(record)
    readWorkspaceFile.mockResolvedValue({ file: {} })
  })

  it('uses the canonical execution file identity and revision', async () => {
    expect(await resolveStoredFileProvenanceSource(file, context)).toEqual({
      identity: {
        fileId: record.id,
        key: record.key,
        context: 'execution',
        contentUpdatedAt: revision,
      },
      ownerUserId: 'writer',
    })
    expect(metadata).toHaveBeenCalledWith(file.key, undefined, { includeDeleted: true })
  })

  it.each([
    { workspaceId: 'foreign-workspace' },
    { workflowId: 'foreign-workflow' },
    { executionId: 'foreign-execution' },
  ])('refuses an out-of-scope file before metadata lookup: %j', async (scope) => {
    await expect(resolveStoredFileProvenanceSource(file, { ...context, ...scope })).rejects.toThrow(
      'File not found'
    )
    expect(metadata).not.toHaveBeenCalled()
  })

  it('accepts a causally inherited file key in the same workflow', async () => {
    await expect(
      resolveStoredFileProvenanceSource(file, {
        ...context,
        executionId: 'resumed-execution',
        fileKeys: [file.key],
      })
    ).resolves.toMatchObject({ identity: { fileId: 'canonical-file' } })
  })

  it('does not let a file key allowlist cross workspaces', async () => {
    await expect(
      resolveStoredFileProvenanceSource(file, {
        ...context,
        workspaceId: 'foreign-workspace',
        fileKeys: [file.key],
      })
    ).rejects.toThrow('File not found')
    expect(metadata).not.toHaveBeenCalled()
  })

  it('rejects a forged context before metadata lookup', async () => {
    await expect(
      resolveStoredFileProvenanceSource({ ...file, context: 'workspace' }, context)
    ).rejects.toThrow('File context does not match its storage key')
    expect(metadata).not.toHaveBeenCalled()
  })

  it.each([
    { workspaceId: 'foreign-workspace' },
    { context: 'workspace' },
    { context: 'knowledge-base' },
  ])('rejects mismatched canonical metadata: %j', async (changes) => {
    metadata.mockResolvedValue({ ...record, ...changes })
    await expect(resolveStoredFileProvenanceSource(file, context)).rejects.toThrow('File not found')
  })

  it('preserves a missing legacy record as absence', async () => {
    metadata.mockResolvedValue(null)
    await expect(resolveStoredFileProvenanceSource(file, context)).resolves.toBeUndefined()
  })

  it('does not turn metadata lookup failures into legacy absence', async () => {
    metadata.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveStoredFileProvenanceSource(file, context)).rejects.toThrow(
      'database unavailable'
    )
  })

  it('requires the workspace file use case before resolving a workspace source', async () => {
    const workspaceFile = { key: 'workspace/workspace-1/file.txt', context: 'workspace' as const }
    readWorkspaceFile.mockRejectedValue(new Error('Workspace access denied'))
    await expect(resolveStoredFileProvenanceSource(workspaceFile, context)).rejects.toThrow(
      'Workspace access denied'
    )
    expect(metadata).not.toHaveBeenCalled()
  })
})
