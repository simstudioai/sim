/**
 * @vitest-environment node
 *
 * The public form submit runs a workflow on the workspace's billing account for
 * an anonymous visitor. Fields are validated against the STORED module config
 * (§2.6), the resolved workflow is re-asserted against the interface's own
 * workspace (§2.3 STEP 5), and the run is billed to the system actor (§2.8).
 *
 * `validateFormSubmission` is deliberately left unmocked — it is database-free
 * and is the actual authority on which values a visitor may submit.
 */
import { executionPreprocessingMock, executionPreprocessingMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceModule } from '@/lib/interfaces'

const {
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockResolvePublicInterfaceModule,
  mockTryAdmit,
  mockAdmissionRejectedResponse,
  mockRelease,
  mockReleaseExecutionSlot,
  mockExecuteWorkflow,
} = vi.hoisted(() => ({
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockResolvePublicInterfaceModule: vi.fn(),
  mockTryAdmit: vi.fn(),
  mockAdmissionRejectedResponse: vi.fn(),
  mockRelease: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockExecuteWorkflow: vi.fn(),
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))

vi.mock('@/lib/public-shares/interface-access', () => ({
  resolvePublicInterfaceModule: mockResolvePublicInterfaceModule,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: mockTryAdmit,
  admissionRejectedResponse: mockAdmissionRejectedResponse,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mockExecuteWorkflow,
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

import { POST } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/submit/route'

const TOKEN = 'tok_1'
const MODULE_ID = 'mod-form'
const WS = 'ws-a'
const OTHER_WS = 'ws-b'
const WORKFLOW_ID = 'wf-form-stored'

const params = (token = TOKEN, moduleId = MODULE_ID) => ({
  params: Promise.resolve({ token, moduleId }),
})

const postRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/interfaces/public/${TOKEN}/modules/${MODULE_ID}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const formModule: InterfaceModule = {
  id: MODULE_ID,
  type: 'form',
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  config: {
    workflowId: WORKFLOW_ID,
    submitLabel: 'Submit',
    fields: [
      { id: 'f-1', name: 'email', label: 'Email', type: 'short-text', required: true },
      {
        id: 'f-2',
        name: 'topic',
        label: 'Topic',
        type: 'dropdown',
        required: false,
        options: ['Billing', 'Bugs'],
      },
    ],
  },
}

const access = {
  share: { id: 'sh_1', token: TOKEN, authType: 'public', password: null },
  definition: {
    id: 'int-a',
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [formModule] },
    createdBy: 'owner-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
  workspaceId: WS,
  module: formModule,
  resource: { type: 'workflow' as const, id: WORKFLOW_ID },
}

function preprocessSuccess(workspaceId = WS) {
  return {
    success: true,
    actorUserId: 'system-actor',
    billingAttribution: { actorUserId: 'system-actor', workspaceId },
    workflowRecord: {
      id: WORKFLOW_ID,
      userId: 'owner-1',
      workspaceId,
      isDeployed: true,
      variables: {},
    },
  }
}

describe('POST /api/interfaces/public/[token]/modules/[moduleId]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockTryAdmit.mockReturnValue({ release: mockRelease })
    mockAdmissionRejectedResponse.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )
    mockResolvePublicInterfaceModule.mockResolvedValue({ ok: true, access })
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue(preprocessSuccess())
    mockExecuteWorkflow.mockResolvedValue({
      success: true,
      output: { ok: true },
      metadata: { executionId: 'exec-1' },
    })
  })

  it('returns 429 from the per-IP execute bucket before the chain', async () => {
    mockEnforcePerIp.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(429)
    expect(mockResolvePublicInterfaceModule).not.toHaveBeenCalled()
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  /**
   * Each token-bucket read is a *consume*, not a peek, so charging the per-IP
   * bucket a second time for the per-share check would silently halve its
   * effective limit. Exactly one debit per request.
   */
  it('consumes the per-IP execute bucket exactly once', async () => {
    await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'execute')
  })

  it('enforces the per-share execute bucket with the resolved share id', async () => {
    await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(mockEnforcePerShare).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerShare).toHaveBeenCalledWith('execute', 'sh_1')
  })

  it('stops on the per-share bucket without running the workflow', async () => {
    mockEnforcePerShare.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(429)
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it('returns the admission-gate rejection at capacity', async () => {
    mockTryAdmit.mockReturnValueOnce(null)
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(429)
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it('runs the chain with the form type pinned', async () => {
    await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(mockResolvePublicInterfaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, moduleId: MODULE_ID, expectedType: 'form' })
    )
  })

  it('propagates a 401 from the gate without executing anything', async () => {
    mockResolvePublicInterfaceModule.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'auth_required_email' }, { status: 401 }),
    })
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(401)
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalled()
  })

  it('400s a submission missing a required field, with per-field details', async () => {
    const res = await POST(postRequest({ values: {} }), params())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.details).toEqual([
      expect.objectContaining({ fieldId: 'f-1', path: ['values', 'f-1'] }),
    ])
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  /**
   * §2.6 — validation runs against the stored field definitions, so a value for
   * a field the interface does not declare is rejected rather than forwarded
   * into the workflow input.
   */
  it('400s a value for a field id that is not in the stored config', async () => {
    const res = await POST(
      postRequest({ values: { 'f-1': 'a@b.com', 'f-injected': 'payload' } }),
      params()
    )
    expect(res.status).toBe(400)
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it('400s a dropdown value outside the stored options', async () => {
    const res = await POST(
      postRequest({ values: { 'f-1': 'a@b.com', 'f-2': 'Not an option' } }),
      params()
    )
    expect(res.status).toBe(400)
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it('never bills the share creator as the actor', async () => {
    await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    const args = executionPreprocessingMockFns.mockPreprocessExecution.mock.calls[0][0]
    expect(args.useAuthenticatedUserAsActor).toBeFalsy()
    expect(args.triggerType).toBe('form')
    expect(args.workflowId).toBe(WORKFLOW_ID)
  })

  it('404s and releases the billing slot when the workflow is in another workspace', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce(
      preprocessSuccess(OTHER_WS)
    )
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(404)
    expect(mockReleaseExecutionSlot).toHaveBeenCalled()
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'Workflow is not deployed'],
    [402, 'Usage limit exceeded'],
  ])('propagates preprocessing failure %s', async (statusCode, message) => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message, statusCode },
    })
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(statusCode)
    expect(mockExecuteWorkflow).not.toHaveBeenCalled()
  })

  /**
   * §6.6 — the workflow's own error text names blocks and upstream services an
   * anonymous visitor has no business seeing, so only the status survives.
   */
  it('502s without leaking the workflow failure text', async () => {
    mockExecuteWorkflow.mockResolvedValueOnce({
      success: false,
      error: 'Block "Stripe Charge" failed: invalid api key sk_live_secret',
    })
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(502)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('sk_live_secret')
    expect(body).not.toContain('Stripe Charge')
  })

  it('never leaks the internal reason behind a preprocessing refusal', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: `Workflow ${WORKFLOW_ID} is not deployed`, statusCode: 403 },
    })
    const res = await POST(postRequest({ values: { 'f-1': 'a@b.com' } }), params())
    expect(res.status).toBe(403)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('deployed')
    expect(body).not.toContain(WORKFLOW_ID)
  })

  it('accepts a valid submission and maps values to stored field names', async () => {
    const res = await POST(
      postRequest({ values: { 'f-1': 'a@b.com', 'f-2': 'Billing' } }),
      params()
    )
    expect(res.status).toBe(200)
    expect(mockExecuteWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: WORKFLOW_ID, workspaceId: WS }),
      expect.any(String),
      expect.objectContaining({ email: 'a@b.com', topic: 'Billing' }),
      expect.anything(),
      expect.objectContaining({ executionMode: 'sync', workflowTriggerType: 'form' }),
      expect.any(String)
    )
    expect(mockRelease).toHaveBeenCalled()
  })
})
