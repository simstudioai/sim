import {
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

  /** Cross-tenant reads must 404, never 403 — a 403 confirms the run exists. */
  it('conceals a run in another workspace as 404', async () => {
    mocks.download.mockRejectedValueOnce(new NoWorkspaceAccessError())

    const response = await GET(getRequest(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
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
