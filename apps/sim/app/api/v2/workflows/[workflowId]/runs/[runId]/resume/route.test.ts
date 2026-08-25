/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  resume: vi.fn(),
}))

vi.mock('@/lib/api/server/routes', () => {
  class V2RouteInfrastructureError extends Error {}
  const renderOrchestrationError = (error: unknown) => {
    const candidate = error as { code?: string; message?: string; name?: string }
    if (candidate.code === 'not_found') {
      return Response.json(
        { error: { code: 'NOT_FOUND', message: candidate.message ?? 'Not found' } },
        { status: 404 }
      )
    }
    if (candidate.name === 'PersonalApiKeysDisabledError') {
      return Response.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: candidate.message ?? 'Personal API keys are not allowed for this workspace',
          },
        },
        { status: 403 }
      )
    }
    return null
  }
  return {
    admitV2Request: mocks.admit,
    createInternalResourceConcealmentPolicy: vi.fn(() => ({ project: () => null })),
    internalOrchestrationErrorPolicy: { project: () => null },
    createInternalSessionOrExecutorAuth: vi.fn(() => ({ authenticate: vi.fn() })),
    createV2ResourceConcealmentPolicy: vi.fn(
      ({ render }: { render?: (error: unknown) => Response | null }) => ({
        render: render ?? renderOrchestrationError,
      })
    ),
    V2RouteInfrastructureError,
    v2ApiKeyAuth: { kind: 'v2-api-key' },
    v2RateLimits: { publicApi: { kind: 'public-api' } },
    V2_PARSE_DEFAULTS: {},
    v2OrchestrationErrorPolicy: { render: renderOrchestrationError },
  }
})

vi.mock('@/lib/workflows/application/resume-run', () => ({
  resumeWorkflowRun: { execute: mocks.resume },
}))

vi.mock('@/lib/workflows/executor/resume-execution', () => ({
  ResumeWorkflowExecutionError: class ResumeWorkflowExecutionError extends Error {},
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://test.sim.ai',
  SITE_URL: 'https://test.sim.ai',
}))

import { v2ResumeWorkflowContract } from '@/lib/api/contracts/v2/workflows'
import { PersonalApiKeysDisabledError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { POST } from '@/app/api/v2/workflows/[workflowId]/runs/[runId]/resume/route'

const WORKFLOW_ID = 'workflow-1'
const RUN_ID = 'run-1'
const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }

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
    context: { params: Promise.resolve({ workflowId: WORKFLOW_ID, runId: RUN_ID }) },
  }
}

describe('POST /api/v2/workflows/[workflowId]/runs/[runId]/resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.admit.mockResolvedValue({ success: true, auth: { principal } })
  })

  it('runs v2 admission before parsing the bounded request body', async () => {
    mocks.admit.mockResolvedValueOnce({
      success: false,
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
    expect(mocks.admit).toHaveBeenCalledOnce()
    expect(mocks.admit).toHaveBeenCalledWith(
      request,
      workflowOperations.resumeRun,
      { kind: 'v2-api-key' },
      { kind: 'public-api' }
    )
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('stops at request-rate admission without invoking resume execution controls', async () => {
    mocks.admit.mockResolvedValueOnce({
      success: false,
      response: NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } },
        { status: 429, headers: { 'Retry-After': '7' } }
      ),
    })
    const { request, context } = makeRequest(
      JSON.stringify({ contextId: 'context-1', input: { approved: true } })
    )

    const response = await POST(request, context)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('7')
    expect(mocks.resume).not.toHaveBeenCalled()
  })

  it('resumes through the authorized run use case and returns a polling receipt', async () => {
    mocks.resume.mockResolvedValueOnce({
      kind: 'async',
      executionId: 'resume-execution-1',
      jobId: 'resume-job-1',
    })
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
    expect(mocks.resume).toHaveBeenCalledWith({
      principal,
      input: {
        workflowId: WORKFLOW_ID,
        runId: RUN_ID,
        contextId: 'context-1',
        resumeInput: { approved: true },
      },
      request,
    })
  })

  it('returns queued resumes as the declared v2 receipt', async () => {
    mocks.resume.mockResolvedValueOnce({
      kind: 'queued',
      executionId: 'resume-execution-2',
      queuePosition: 2,
    })
    const { request, context } = makeRequest(JSON.stringify({ contextId: 'context-2' }))

    const response = await POST(request, context)
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toEqual({
      data: {
        runId: 'resume-execution-2',
        statusUrl: 'https://test.sim.ai/api/v2/workflows/workflow-1/runs/resume-execution-2',
        queuePosition: 2,
      },
    })
    expect(v2ResumeWorkflowContract.response.schema.parse(body)).toEqual(body)
  })

  it('wraps synchronous resume results in the canonical v2 run shape', async () => {
    mocks.resume.mockResolvedValueOnce({
      kind: 'sync',
      success: true,
      status: 'completed',
      executionId: 'resume-execution-3',
      output: { approved: true },
      error: undefined,
      metadata: {
        startTime: '2026-08-05T00:00:00.000Z',
        endTime: '2026-08-05T00:00:01.000Z',
        duration: 1000,
      },
    })
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

  it('conceals canonical parent-run/workflow mismatches as absence', async () => {
    mocks.resume.mockRejectedValueOnce(new OrchestrationError('not_found', 'Run not found'))
    const { request, context } = makeRequest(JSON.stringify({ contextId: 'context-4' }))

    const response = await POST(request, context)

    expect(response.status).toBe(404)
    expect((await response.json()).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Run not found',
    })
  })

  it('preserves the personal-key-disabled authorization response as forbidden', async () => {
    mocks.resume.mockRejectedValueOnce(new PersonalApiKeysDisabledError())
    const { request, context } = makeRequest(JSON.stringify({ contextId: 'context-5' }))

    const response = await POST(request, context)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  it('returns a safe error when the resume manager fails', async () => {
    mocks.resume.mockRejectedValueOnce(new Error('resume database connection details'))
    const { request, context } = makeRequest(JSON.stringify({ contextId: 'context-6' }))

    const response = await POST(request, context)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
})
