/** @vitest-environment node */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('@/lib/workflows/application/preview-manual-workflow-from-block', () => ({
  previewManualWorkflowFromBlock: {
    operation: { id: 'workflows.manual.preview_from_block' },
    execute: mocks.preview,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError, WorkspaceApiKeyAuthorizationError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/workflows/[workflowId]/runs/preview/route'

const routeContext = { params: Promise.resolve({ workflowId: 'workflow-1' }) }
const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const result = {
  workflowId: 'workflow-1',
  sourceRunId: 'source-1',
  startBlockId: 'block-1',
  validation: { valid: false, error: 'Upstream dependency not executed: parent-1' },
  rerunBlocks: [
    { blockId: 'block-1', name: 'Send report', type: 'slack', executedInSource: false },
  ],
  upstreamBlocks: [
    {
      blockId: 'parent-1',
      name: 'Read report',
      type: 'function',
      executedInSource: false,
      hasCachedOutput: false,
    },
  ],
  notes: ['Conditional paths are candidates.'],
}

function request(query = 'blockId=block-1&sourceRunId=source-1') {
  return new NextRequest(`http://localhost/api/v2/workflows/workflow-1/runs/preview?${query}`)
}

describe('GET partial-run preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue({
      principal,
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.preview.mockResolvedValue(result)
  })

  it('maps path and query through the use case and returns validation failures in a read-only envelope', async () => {
    const response = await GET(request(), routeContext)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: result })
    expect(mocks.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        principal,
        input: { workflowId: 'workflow-1', blockId: 'block-1', sourceRunId: 'source-1' },
      })
    )
  })

  it.each([
    '',
    'blockId=block-1',
    'blockId=&sourceRunId=source-1',
    'blockId=block-1&sourceRunId=source-1&async=true',
  ])('rejects incomplete or execution-only query %s', async (query) => {
    const response = await GET(request(query), routeContext)
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('authenticates before parsing', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError())
    expect((await GET(request('invalid=true'), routeContext)).status).toBe(401)
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('conceals inaccessible workflows while retaining actionable workspace-key refusal', async () => {
    mocks.preview.mockRejectedValueOnce(new NoWorkspaceAccessError())
    const hidden = await GET(request(), routeContext)
    expect(hidden.status).toBe(404)
    expect(hidden.headers.get('Cache-Control')).toBe('private, no-store')
    mocks.preview.mockRejectedValueOnce(new WorkspaceApiKeyAuthorizationError())
    const forbidden = await GET(request(), routeContext)
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).error.details.code).toBe(
      'WORKSPACE_KEY_OPERATION_NOT_PERMITTED'
    )
  })
})
