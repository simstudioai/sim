/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHandleResumeExecution, mockResolveV2WorkflowAccess } = vi.hoisted(() => ({
  mockHandleResumeExecution: vi.fn(),
  mockResolveV2WorkflowAccess: vi.fn(),
}))

vi.mock('@/app/api/resume/resume-handler', () => ({
  handleResumeExecution: mockHandleResumeExecution,
}))

vi.mock('@/app/api/v2/workflows/lib/access', () => ({
  resolveV2WorkflowAccess: mockResolveV2WorkflowAccess,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://test.sim.ai',
}))

import { v2ResumeWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { POST } from '@/app/api/v2/workflows/[id]/runs/[runId]/resume/route'

const WORKFLOW_ID = 'workflow-1'
const RUN_ID = 'run-1'

function makeRequest(body: string) {
  return {
    request: new NextRequest(
      `http://localhost/api/v2/workflows/${WORKFLOW_ID}/runs/${RUN_ID}/resume`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
        body,
      }
    ),
    context: { params: Promise.resolve({ id: WORKFLOW_ID, runId: RUN_ID }) },
  }
}

describe('POST /api/v2/workflows/[id]/runs/[runId]/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveV2WorkflowAccess.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      keyType: 'workspace',
      workflow: { id: WORKFLOW_ID, workspaceId: 'workspace-1' },
    })
  })

  it('authenticates before parsing the request body', async () => {
    mockResolveV2WorkflowAccess.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 }
      ),
    })
    const { request, context } = makeRequest('{')

    const response = await POST(request, context)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    })
    expect(mockResolveV2WorkflowAccess).toHaveBeenCalledWith(request, WORKFLOW_ID, 'write')
    expect(mockHandleResumeExecution).not.toHaveBeenCalled()
  })

  it('resumes a pause context through the run-scoped v2 endpoint', async () => {
    mockHandleResumeExecution.mockResolvedValueOnce(
      NextResponse.json(
        {
          success: true,
          async: true,
          executionId: 'resume-execution-1',
          message: 'Resume execution queued',
          statusUrl: 'https://test.sim.ai/api/v2/workflows/workflow-1/runs/resume-execution-1',
        },
        { status: 202 }
      )
    )
    const { request, context } = makeRequest(
      JSON.stringify({ contextId: 'context-1', input: { approved: true } })
    )

    const response = await POST(request, context)
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(response.headers.get('X-Run-Id')).toBe('resume-execution-1')
    expect(body).toEqual({
      data: {
        runId: 'resume-execution-1',
        statusUrl: 'https://test.sim.ai/api/v2/workflows/workflow-1/runs/resume-execution-1',
      },
    })
    expect(v2ResumeWorkflowContract.response.schema.parse(body)).toEqual(body)
    expect(mockHandleResumeExecution).toHaveBeenCalledWith({
      request,
      workflowId: WORKFLOW_ID,
      executionId: RUN_ID,
      contextId: 'context-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      resumeInput: { approved: true },
      isApiCaller: true,
      pollingSurface: 'v2',
      allowStreaming: false,
    })
  })

  it('returns queued resumes as a v2 polling receipt', async () => {
    mockHandleResumeExecution.mockResolvedValueOnce(
      NextResponse.json({
        status: 'queued',
        executionId: 'resume-execution-2',
        queuePosition: 2,
        message: 'Resume queued. It will run after current resumes finish.',
      })
    )
    const { request, context } = makeRequest(JSON.stringify({ contextId: 'context-2' }))

    const response = await POST(request, context)

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      data: {
        runId: 'resume-execution-2',
        statusUrl: 'https://test.sim.ai/api/v2/workflows/workflow-1/runs/resume-execution-2',
        queuePosition: 2,
      },
    })
  })

  it('wraps synchronous resume results in the canonical v2 run shape', async () => {
    mockHandleResumeExecution.mockResolvedValueOnce(
      NextResponse.json({
        success: true,
        status: 'completed',
        executionId: 'resume-execution-3',
        output: { approved: true },
        metadata: {
          startTime: '2026-08-05T00:00:00.000Z',
          endTime: '2026-08-05T00:00:01.000Z',
          duration: 1000,
        },
      })
    )
    const { request, context } = makeRequest(JSON.stringify({ contextId: 'context-3' }))

    const response = await POST(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      data: {
        runId: 'resume-execution-3',
        workflowId: WORKFLOW_ID,
        status: 'completed',
        output: { approved: true },
        error: null,
        startedAt: '2026-08-05T00:00:00.000Z',
        endedAt: '2026-08-05T00:00:01.000Z',
        durationMs: 1000,
      },
    })
    expect(v2ResumeWorkflowContract.response.schema.parse(body)).toEqual(body)
  })
})
