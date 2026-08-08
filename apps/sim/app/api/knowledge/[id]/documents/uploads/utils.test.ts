/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

import { requireKnowledgeDocumentUploadActor } from '@/app/api/knowledge/[id]/documents/uploads/utils'

describe('knowledge-document upload session authentication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the authoritative session id with the authenticated user', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User', email: 'user@example.com' },
      session: { id: 'session-1' },
    })

    await expect(requireKnowledgeDocumentUploadActor()).resolves.toEqual({
      id: 'user-1',
      sessionId: 'session-1',
      name: 'User',
      email: 'user@example.com',
    })
  })

  it('fails fast when authenticated state has no session id', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' }, session: {} })

    await expect(requireKnowledgeDocumentUploadActor()).rejects.toThrow(
      'Authenticated session is missing its session ID'
    )
  })
})
