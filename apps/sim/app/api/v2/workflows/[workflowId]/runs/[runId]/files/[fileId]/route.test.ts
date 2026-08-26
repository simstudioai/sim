/**
 * @vitest-environment node
 */
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

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  authorizeDownload: vi.fn(),
}))

vi.mock('@/lib/workflows/application/download-workflow-run-file', () => ({
  downloadWorkflowRunFileStream: {
    operation: {
      id: 'workflows.download_run_file',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
    },
    execute: mocks.download,
    authorize: mocks.authorizeDownload,
  },
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId]/route'

const WORKSPACE_ID = 'workspace-1'
const WORKFLOW_ID = '3b1f7c92-8d4e-4a6b-9c0d-5e2f8a714b36'
const RUN_ID = 'run_8f14e45f-ceea-467f-a'
const FILE_ID = 'file_report'

const context = {
  params: Promise.resolve({ workflowId: WORKFLOW_ID, runId: RUN_ID, fileId: FILE_ID }),
}

const workspaceKeyAuth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const personalKeyAuth = {
  principal: {
    kind: 'personal_api_key' as const,
    userId: 'user-1',
    keyId: 'key-2',
  },
  rateLimitSubjectIds: ['api-key:key-2'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

function url(): string {
  return `http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/files/${FILE_ID}`
}

function getRequest(): NextRequest {
  return new NextRequest(url())
}

function headRequest(): NextRequest {
  return new NextRequest(url(), { method: 'HEAD' })
}

describe('GET /api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(workspaceKeyAuth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.authorizeDownload.mockResolvedValue(undefined)
    mocks.download.mockResolvedValue({
      file: { id: FILE_ID, name: 'report.pdf', key: 'execution/ws/wf/run/report.pdf', size: 3 },
      stream: new Blob(['pdf']).stream(),
      contentType: 'application/pdf',
      contentLength: 3,
    })
  })

  /**
   * The regression test for the whole cluster: run output carries
   * `/api/files/serve/...` URLs that reject `x-api-key` outright, so a
   * workspace key succeeding here is the byte path that previously did not
   * exist for an async run.
   */
  it('serves run bytes to a workspace API key', async () => {
    const response = await GET(getRequest(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toContain('report.pdf')
    expect(response.headers.get('Content-Length')).toBe('3')
    expect(await response.text()).toBe('pdf')
  })

  it('serves run bytes to a personal API key', async () => {
    v2RouteMocks.authenticate.mockResolvedValueOnce(personalKeyAuth)

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('pdf')
  })

  /**
   * The caller addresses a file by id only. Nothing resembling a storage key
   * reaches the use case, so the endpoint cannot be aimed at other bytes.
   */
  it('passes only the path identifiers to the use case', async () => {
    await GET(getRequest(), context)

    expect(mocks.download).toHaveBeenCalledWith({
      principal: workspaceKeyAuth.principal,
      input: { workflowId: WORKFLOW_ID, runId: RUN_ID, fileId: FILE_ID },
      request: expect.anything(),
    })
  })

  it('sets private, no-store caching on the bytes', async () => {
    const response = await GET(getRequest(), context)

    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('surfaces operation rate-limit headers', async () => {
    const response = await GET(getRequest(), context)

    expect(response.headers.get('X-RateLimit-Remaining')).toBe('99')
  })

  it('rejects an unauthenticated request', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  /** Cross-tenant reads must 404, never 403 — a 403 confirms the run exists. */
  it('conceals a run in another workspace as 404', async () => {
    mocks.download.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('reports a run that has not finished as a conflict', async () => {
    mocks.download.mockRejectedValueOnce(
      new OrchestrationError('conflict', 'Run has not finished yet')
    )

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(409)
  })

  /**
   * `headSafe: false`: a `HEAD` authorizes and answers bodiless without running
   * the download, so it never records a `FILE_DOWNLOADED` audit event and never
   * becomes an existence oracle for a file the `GET` would 404.
   */
  it('answers an authorized HEAD bodiless without downloading', async () => {
    const response = await GET(headRequest(), context)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(mocks.download).not.toHaveBeenCalled()
    expect(mocks.authorizeDownload).toHaveBeenCalledOnce()
  })

  it('does not confirm via HEAD a run the caller cannot reach', async () => {
    mocks.authorizeDownload.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(headRequest(), context)

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('does not confirm via HEAD a file id that does not exist', async () => {
    mocks.authorizeDownload.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'File not found')
    )

    const response = await GET(headRequest(), context)

    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
