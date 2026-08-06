/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockImportWorkspaceFileSecretProvenanceForValue } = vi.hoisted(() => ({
  mockImportWorkspaceFileSecretProvenanceForValue: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  importWorkspaceFileSecretProvenanceForValue: mockImportWorkspaceFileSecretProvenanceForValue,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import {
  assertOpaqueWorkspaceFileModelSafe,
  projectServerToolModelInput,
} from '@/lib/copilot/tools/server/model-input'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'reference.png',
  key: 'workspace/workspace-1/reference.png',
  path: '/api/files/serve/reference.png',
  size: 10,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  storageContext: 'workspace' as const,
}

describe('server tool model-input boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImportWorkspaceFileSecretProvenanceForValue.mockResolvedValue(true)
  })

  it('projects only active text secrets to their canonical aliases', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PROMPT', plaintext: 'private prompt', encryptedValue: 'encrypted-prompt' },
      { name: 'LYRICS', plaintext: 'private lyrics', encryptedValue: 'encrypted-lyrics' },
    ])
    registry.recordResolved('PROMPT', 'private prompt')
    registry.recordResolved('LYRICS', 'private lyrics')

    expect(
      projectServerToolModelInput(
        { prompt: 'private prompt', lyrics: 'private lyrics', ordinary: 'keep me' },
        { userId: 'user-1', resolvedSecretTraceRegistry: registry }
      )
    ).toEqual({ prompt: '{{PROMPT}}', lyrics: '{{LYRICS}}', ordinary: 'keep me' })
  })

  it('fails closed when the child registry is missing or incomplete', () => {
    expect(() => projectServerToolModelInput({ prompt: 'hello' })).toThrow(
      'could not be projected safely'
    )

    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()
    expect(() =>
      projectServerToolModelInput(
        { prompt: 'hello' },
        { userId: 'user-1', resolvedSecretTraceRegistry: registry }
      )
    ).toThrow('could not be projected safely')
  })

  it('binds opaque checks to the exact workspace file before allowing model egress', async () => {
    const registry = new ResolvedSecretTraceRegistry()

    await expect(
      assertOpaqueWorkspaceFileModelSafe({
        workspaceId: 'workspace-1',
        file,
        context: { userId: 'user-1', resolvedSecretTraceRegistry: registry },
      })
    ).resolves.toBeUndefined()
    expect(mockImportWorkspaceFileSecretProvenanceForValue).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      identity: {
        fileId: 'file-1',
        key: 'workspace/workspace-1/reference.png',
        context: 'workspace',
      },
      value: { key: 'workspace/workspace-1/reference.png' },
      registry,
      opaqueAttachment: true,
    })
  })

  it('rejects tainted or unavailable opaque provenance', async () => {
    mockImportWorkspaceFileSecretProvenanceForValue.mockResolvedValue(false)

    await expect(
      assertOpaqueWorkspaceFileModelSafe({ workspaceId: 'workspace-1', file })
    ).rejects.toThrow('File cannot be sent to a model')
  })
})
