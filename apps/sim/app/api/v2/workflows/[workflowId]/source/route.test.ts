import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(), authorizeRead: vi.fn(), apply: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/application/get-workflow-source', () => ({
  getWorkflowSource: {
    operation: { id: 'workflows.source.read' },
    authorize: mocks.authorizeRead,
    execute: mocks.read,
  },
}))

vi.mock('@/lib/workflows/application/apply-workflow-source', () => ({
  applyWorkflowSource: {
    operation: { id: 'workflows.source.apply' },
    execute: mocks.apply,
  },
}))
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import { GET, POST } from '@/app/api/v2/workflows/[workflowId]/source/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const WORKFLOW_ID = '66666666-7777-4888-9999-000000000000'
const FINGERPRINT = `sf1:${'c'.repeat(64)}`

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
    access: 'write' as const,
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const source = {
  workflowId: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  files: { 'workflow.ts': "// @sim-sdk 1\nexport default workflow('W', () => {})\n" },
  lock: {
    lockVersion: 1 as const,
    blocks: { start: { id: 'b-1', parent: null, binding: 'start', order: 0 } },
    variables: {},
  },
  lockBase: { workspaceId: WORKSPACE_ID, baseFingerprint: FINGERPRINT, catalogHash: 'h' },
  fingerprint: FINGERPRINT,
  canonicalHash: 'd'.repeat(64),
  catalogVersion: 'h',
  sdkMajor: 1,
  blockTypes: ['start_trigger'],
  warnings: [],
}

function request(query = '') {
  return new NextRequest(`http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/source${query}`, {
    headers: { 'x-api-key': 'key' },
  })
}

const context = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

describe('GET /api/v2/workflows/{workflowId}/source', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue(source)
    mocks.authorizeRead.mockResolvedValue(undefined)
  })

  it('answers HEAD after authorizing without reading, so a probe never allocates resource keys', async () => {
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/source`, {
        method: 'HEAD',
        headers: { 'x-api-key': 'key' },
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.authorizeRead).toHaveBeenCalledTimes(1)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('passes annotateIds as a boolean and functionCode through, omitting absent flags', async () => {
    await GET(request('?annotateIds=1&functionCode=inline'), context)
    await GET(request(), context)

    expect(mocks.read.mock.calls[0][0].input).toEqual({
      workflowId: WORKFLOW_ID,
      annotateIds: true,
      functionCode: 'inline',
    })
    expect(mocks.read.mock.calls[1][0].input).toEqual({ workflowId: WORKFLOW_ID })
  })

  it.each(['?functionCode=ts', '?annotate=true'])(
    'rejects %s with 400 before reading the workflow',
    async (query) => {
      const response = await GET(request(query), context)

      expect(response.status).toBe(400)
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

  it('answers 403 while code-first workflows are off', async () => {
    mocks.read.mockRejectedValue(
      new OrchestrationError('forbidden', 'Code-first workflows are not enabled')
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  it('answers 404 for a workflow the key cannot reach', async () => {
    mocks.read.mockRejectedValue(new OrchestrationError('not_found', 'Workflow not found'))

    const response = await GET(request(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})

function applyRequest(body: unknown, query = '') {
  return new NextRequest(`http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/source${query}`, {
    method: 'POST',
    headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const personalKeyAuth = {
  ...auth,
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-2' },
  keyType: 'personal' as const,
}

const applyBody = {
  files: source.files,
  lock: source.lock,
  lockBase: source.lockBase,
  baseFingerprint: FINGERPRINT,
}

const applied = {
  workflowId: WORKFLOW_ID,
  workflowName: 'W',
  workspaceId: WORKSPACE_ID,
  dryRun: false,
  applied: true,
  diff: {
    noop: false,
    blocks: {
      added: [],
      removed: [],
      renamed: [],
      modified: [{ id: 'b-1', key: 'start', fields: ['name'] }],
    },
    edges: { added: 0, removed: 0 },
    variables: { added: [], removed: [], modified: [] },
  },
  diagnostics: [],
  newFingerprint: `sf1:${'e'.repeat(64)}`,
  files: source.files,
  lock: source.lock,
  lockBase: source.lockBase,
  mintedIds: {},
  warnings: [],
  needsRedeployment: true,
  sdkMajor: 1,
  catalogVersion: 'h',
}

describe('POST /api/v2/workflows/{workflowId}/source', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.apply.mockResolvedValue(applied)
  })

  it('answers 400 with the line-pinned diagnostics of refused source', async () => {
    const diagnostic = {
      code: 'E_APPLY_PROTECTED_BLOCK' as const,
      severity: 'error' as const,
      message: 'Block "Start" is locked',
      file: 'workflow.ts',
      line: 4,
      column: 3,
      blockId: 'b-1',
    }
    mocks.apply.mockRejectedValue(new WorkflowSourceRejectedError([diagnostic]))

    const response = await POST(applyRequest(applyBody), context)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details).toEqual({ code: 'SOURCE_REJECTED', diagnostics: [diagnostic] })
  })

  it('answers 409 with the current fingerprint when the draft moved', async () => {
    const current = `sf1:${'f'.repeat(64)}`
    mocks.apply.mockRejectedValue(new WorkflowSourceStaleError(current))

    const response = await POST(applyRequest(applyBody), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details).toEqual({ code: 'SOURCE_STALE', currentFingerprint: current })
  })

  it('answers 423 for a locked workflow', async () => {
    mocks.apply.mockRejectedValue(new OrchestrationError('locked', 'Workflow is locked'))

    const response = await POST(applyRequest(applyBody), context)

    expect(response.status).toBe(423)
  })

  it('rejects an unknown body field with 400 before applying', async () => {
    const response = await POST(applyRequest({ ...applyBody, atomic: true }), context)

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('passes x- extension fields on the lock, its blocks and their layout through to apply', async () => {
    const lock = {
      ...source.lock,
      'x-tool': { pinned: true },
      blocks: {
        start: {
          ...source.lock.blocks.start,
          'x-note': 'keep',
          layout: { x: 0, y: 0, 'x-snap': 8 },
        },
      },
    }

    const response = await POST(applyRequest({ ...applyBody, lock }), context)

    expect(response.status).toBe(200)
    expect(mocks.apply.mock.calls[0][0].input.lock).toEqual(lock)
  })

  it('rejects an unknown non-extension lock block field with 400 before applying', async () => {
    const lock = {
      ...source.lock,
      blocks: { start: { ...source.lock.blocks.start, type: 'starter' } },
    }

    const response = await POST(applyRequest({ ...applyBody, lock }), context)

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('rejects files without workflow.ts with 400 before applying', async () => {
    const response = await POST(
      applyRequest({ ...applyBody, files: { 'functions/a.js': 'return 1' } }),
      context
    )

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('passes dryRun as a boolean and keeps the result out of analytics', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)
    mocks.apply.mockResolvedValue({ ...applied, dryRun: true, applied: false })

    const response = await POST(applyRequest(applyBody, '?dryRun=true'), context)

    expect(response.status).toBe(200)
    expect(mocks.apply.mock.calls[0][0].input).toMatchObject({
      workflowId: WORKFLOW_ID,
      dryRun: true,
    })
    expect((await response.json()).data.applied).toBe(false)
    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
  })

  it('records workflow_source_applied for a personal key that changed the draft', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(personalKeyAuth)

    await POST(applyRequest({ ...applyBody, provenance: { client: 'cli' } }), context)

    expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'workflow_source_applied',
      { workflow_id: WORKFLOW_ID, workspace_id: WORKSPACE_ID, source: 'cli', ok: true, ops: 1 },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })

  it('records a Copilot-delegated apply as its subject user with source copilot', async () => {
    v2RouteMocks.authenticate.mockResolvedValue({
      ...auth,
      principal: createDelegatedPrincipal({ subjectUserId: 'user-9', workspaceId: WORKSPACE_ID }),
    })

    await POST(applyRequest({ ...applyBody, provenance: { client: 'cli' } }), context)

    expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-9',
      'workflow_source_applied',
      { workflow_id: WORKFLOW_ID, workspace_id: WORKSPACE_ID, source: 'copilot', ok: true, ops: 1 },
      { groups: { workspace: WORKSPACE_ID } }
    )
  })
})
