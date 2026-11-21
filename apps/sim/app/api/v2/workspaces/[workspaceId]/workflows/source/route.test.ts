import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/application/apply-workflow-source', () => ({
  createWorkflowFromSource: {
    operation: { id: 'workflows.source.create' },
    execute: mocks.create,
  },
}))

import {
  WorkflowSourceNameTakenError,
  WorkflowSourceRejectedError,
} from '@/lib/workflows/application/source-error'
import { POST } from '@/app/api/v2/workspaces/[workspaceId]/workflows/source/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const WORKFLOW_ID = '66666666-7777-4888-9999-000000000000'
const FINGERPRINT = `sf1:${'c'.repeat(64)}`

const auth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-2' },
  rateLimitSubjectIds: ['api-key:key-2'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const files = {
  'workflow.ts':
    "// @sim-sdk 1\nimport { trigger, workflow } from '@sim/workflow-sdk'\n\nexport default workflow('Triage', () => {\n  trigger.start('Start')\n})\n",
}

const created = {
  workflowId: WORKFLOW_ID,
  workflowName: 'Triage',
  workspaceId: WORKSPACE_ID,
  dryRun: false,
  applied: true,
  diff: {
    noop: false,
    blocks: {
      added: [{ id: 'b-1', key: 'start', type: 'start_trigger' }],
      removed: [],
      renamed: [],
      modified: [],
    },
    edges: { added: 0, removed: 0 },
    variables: { added: [], removed: [], renamed: [], modified: [] },
  },
  diagnostics: [],
  files,
  lock: {
    version: 1 as const,
    blocks: { start: { id: 'b-1', parent: null, ident: 'start', order: 0 } },
    variables: {},
  },
  base: {
    version: 1 as const,
    workflowId: WORKFLOW_ID,
    workspaceId: WORKSPACE_ID,
    fingerprint: FINGERPRINT,
    catalogHash: 'h',
  },
  mintedIds: { start: 'b-1' },
  notes: [],
  needsRedeployment: false,
  sdkMajor: 1,
}

function createRequest(body: unknown, query = '') {
  return new NextRequest(
    `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source${query}`,
    {
      method: 'POST',
      headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
}

const context = { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }

describe('POST /api/v2/workspaces/{workspaceId}/workflows/source', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.create.mockResolvedValue(created)
  })

  it('creates in the workspace named by the path and returns the new id, files and lock', async () => {
    const response = await POST(
      createRequest({ files, name: 'Triage', folderPath: 'Ops' }),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.create.mock.calls[0][0].input).toEqual({
      workspaceId: WORKSPACE_ID,
      files,
      name: 'Triage',
      folderPath: '/Ops',
    })
    const { data } = await response.json()
    expect(data.workflowId).toBe(WORKFLOW_ID)
    expect(data.lock).toEqual(created.lock)
    expect(data.files).toEqual(files)
  })

  it('answers 400 with the line-pinned diagnostics of refused source', async () => {
    const diagnostic = {
      code: 'E_UNKNOWN_PARAM' as const,
      severity: 'error' as const,
      message: 'Slack has no param credential.',
      file: 'workflow.ts',
      line: 5,
      column: 3,
    }
    mocks.create.mockRejectedValue(new WorkflowSourceRejectedError([diagnostic]))

    const response = await POST(createRequest({ files }), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.details).toEqual({
      code: 'SOURCE_REJECTED',
      diagnostics: [diagnostic],
    })
  })

  it('answers 409 with SOURCE_NAME_TAKEN when the name is taken in the folder', async () => {
    mocks.create.mockRejectedValue(new WorkflowSourceNameTakenError('Triage'))

    const response = await POST(createRequest({ files }), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details).toEqual({ code: 'SOURCE_NAME_TAKEN', name: 'Triage' })
  })

  it.each([
    ['a lock, which a new workflow has no use for', { files, lock: created.lock }],
    ['files without workflow.ts', { files: { 'functions/a.js': 'return 1' } }],
    ['an empty name', { files, name: '  ' }],
  ])('rejects %s with 400 before creating', async (_label, body) => {
    const response = await POST(createRequest(body), context)

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('answers 429 with Retry-After once the plans this server runs at once are taken, and still creates for real', async () => {
    const finish: Array<() => void> = []
    mocks.create.mockImplementation(({ input }: { input: { dryRun?: boolean } }) =>
      input.dryRun
        ? new Promise((resolve) =>
            finish.push(() => resolve({ ...created, dryRun: true, applied: false }))
          )
        : Promise.resolve(created)
    )
    const running = Array.from({ length: 4 }, () =>
      POST(createRequest({ files }, '?dryRun=true'), context)
    )
    await vi.waitFor(() => expect(finish).toHaveLength(4))

    const refused = await POST(createRequest({ files }, '?dryRun=true'), context)
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe('5')
    expect((await refused.json()).error.code).toBe('RATE_LIMITED')
    expect((await POST(createRequest({ files }), context)).status).toBe(200)

    for (const done of finish) done()
    expect((await Promise.all(running)).map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ])
  })

  it('passes dryRun through', async () => {
    mocks.create.mockResolvedValue({ ...created, dryRun: true, applied: false })

    const response = await POST(createRequest({ files }, '?dryRun=true'), context)

    expect(response.status).toBe(200)
    expect(mocks.create.mock.calls[0][0].input).toMatchObject({ dryRun: true })
  })
})
