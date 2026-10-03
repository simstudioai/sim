import {
  knowledgeAccessScopeMock,
  knowledgeAccessScopeMockFns,
} from '@sim/testing/mocks/knowledge-access-scope.mock'
import { knowledgeServiceMock } from '@sim/testing/mocks/knowledge-service.mock'
import { v1MiddlewareMock } from '@sim/testing/mocks/v1-middleware.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/access/scope', () => knowledgeAccessScopeMock)
vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

import { resolveV1KnowledgeReadAccess } from '@/app/api/v1/knowledge/utils'

const createUserProvider = knowledgeAccessScopeMockFns.mockCreateUserKnowledgeAccessProvider

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
