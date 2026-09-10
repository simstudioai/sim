/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createUserProvider } = vi.hoisted(() => ({ createUserProvider: vi.fn() }))
vi.mock('@/lib/knowledge/access/scope', () => ({
  createUserKnowledgeAccessProvider: createUserProvider,
  WORKSPACE_ACCESS_SCOPE: { kind: 'workspace', tokens: ['pub', 'ws'] },
}))
vi.mock('@/lib/knowledge/service', () => ({ getKnowledgeBaseById: vi.fn() }))
vi.mock('@/app/api/v1/middleware', () => ({ validateWorkspaceAccess: vi.fn() }))

import { resolveV1KnowledgeReadAccess } from '@/app/api/v1/knowledge/utils'

beforeEach(() => vi.clearAllMocks())

describe('v1 knowledge reader identity', () => {
  it.each(['personal', 'oauth_access_token'] as const)(
    'retains live source proof for a %s caller',
    async (keyType) => {
      const provider = { get: vi.fn(), getForConnectors: vi.fn(), getForDocuments: vi.fn() }
      createUserProvider.mockReturnValue(provider)
      await expect(
        resolveV1KnowledgeReadAccess('reader', { keyType }, 'workspace-1')
      ).resolves.toBe(provider)
      expect(createUserProvider).toHaveBeenCalledWith('reader', { workspaceId: 'workspace-1' })
    }
  )

  it('keeps workspace keys actorless without borrowing their creator identity', async () => {
    await expect(
      resolveV1KnowledgeReadAccess('key-creator', { keyType: 'workspace' }, 'workspace-1')
    ).resolves.toMatchObject({ kind: 'workspace' })
    expect(createUserProvider).not.toHaveBeenCalled()
  })
})
