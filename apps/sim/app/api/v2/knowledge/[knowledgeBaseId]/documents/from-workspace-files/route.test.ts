/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAddWorkspaceFiles } = vi.hoisted(() => ({
  mockAddWorkspaceFiles: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/knowledge/application/add-workspace-files', () => ({
  addWorkspaceFilesToKnowledgeBase: {
    operation: { id: 'knowledge.documents.add_workspace_files' },
    execute: mockAddWorkspaceFiles,
  },
}))

import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { POST } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files/route'

const WORKSPACE_ID = 'workspace-1'
const context = { params: Promise.resolve({ knowledgeBaseId: 'kb-1' }) }

function buildRequest(body: unknown) {
  return new NextRequest('http://localhost/api/v2/knowledge/kb-1/documents/from-workspace-files', {
    method: 'POST',
    headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
  v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  v2RouteMocks.authenticate.mockResolvedValue({
    principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
    rateLimitSubjectIds: ['api-key:key-1'],
    rateLimitSubscription: null,
    keyType: 'personal',
  })
  mockAddWorkspaceFiles.mockResolvedValue({
    knowledgeBaseId: 'kb-1',
    knowledgeBaseName: 'Docs',
    added: [
      { documentId: 'doc-1', filename: 'handbook.pdf', mimeType: 'application/pdf', fileSize: 42 },
    ],
    failed: ['missing.pdf'],
    cancelled: false,
  })
})

describe('POST /api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files', () => {
  /**
   * A partial outcome is a 200 with a populated `failed` array. v2 has exactly
   * two body shapes and a 207 multi-status is neither.
   */
  it('reports partial success as a 200 rather than a multi-status', async () => {
    const response = await POST(
      buildRequest({ workspaceId: WORKSPACE_ID, fileReferences: ['handbook.pdf', 'missing.pdf'] }),
      context
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        knowledgeBaseId: 'kb-1',
        added: [
          {
            documentId: 'doc-1',
            filename: 'handbook.pdf',
            mimeType: 'application/pdf',
            fileSize: 42,
          },
        ],
        failed: ['missing.pdf'],
      },
    })
  })

  it('does not leak the knowledge base name the use case carries internally', async () => {
    const response = await POST(
      buildRequest({ workspaceId: WORKSPACE_ID, fileReferences: ['handbook.pdf'] }),
      context
    )

    expect(Object.keys((await response.json()).data).sort()).toEqual([
      'added',
      'failed',
      'knowledgeBaseId',
    ])
  })

  it('rejects an empty reference list', async () => {
    const response = await POST(
      buildRequest({ workspaceId: WORKSPACE_ID, fileReferences: [] }),
      context
    )

    expect(response.status).toBe(400)
    expect(mockAddWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('caps the reference list before the use case runs', async () => {
    const response = await POST(
      buildRequest({
        workspaceId: WORKSPACE_ID,
        fileReferences: Array.from({ length: 101 }, (_, index) => `file-${index}.pdf`),
      }),
      context
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('100')
    expect(mockAddWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('projects a usage limit as 402 rather than a generic failure', async () => {
    mockAddWorkspaceFiles.mockRejectedValue(
      new KnowledgeUsageLimitExceededError('Usage limit exceeded.')
    )

    const response = await POST(
      buildRequest({ workspaceId: WORKSPACE_ID, fileReferences: ['handbook.pdf'] }),
      context
    )

    expect(response.status).toBe(402)
    expect((await response.json()).error.code).toBe('USAGE_LIMIT_EXCEEDED')
  })

  it('denies a workspace API key, as the operation policy declares', () => {
    expect(knowledgeOperations.addWorkspaceFiles.workspaceApiKey).toBe('deny')
    expect(knowledgeOperations.addWorkspaceFiles.principalKinds).not.toContain('workspace_api_key')
  })
})
