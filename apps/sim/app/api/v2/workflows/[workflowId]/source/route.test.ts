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
  read: vi.fn(),
  authorizeRead: vi.fn(),
  apply: vi.fn(),
  create: vi.fn(),
  plan: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/application/read-workflow-source', () => ({
  readWorkflowSource: {
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
  createWorkflowFromSource: {
    operation: { id: 'workflows.source.create' },
    execute: mocks.create,
  },
  planWorkflowSource: {
    operation: { id: 'workflows.source.plan' },
    execute: mocks.plan,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  WorkflowSourceNameTakenError,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import { POST as PLAN } from '@/app/api/v2/workflows/[workflowId]/source/plan/route'
import { GET, POST } from '@/app/api/v2/workflows/[workflowId]/source/route'
import { POST as CREATE } from '@/app/api/v2/workspaces/[workspaceId]/workflows/source/route'

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
  canonicalHash: 'd'.repeat(64),
  sdkMajor: 1,
  blockTypes: ['start_trigger'],
  diagnostics: [],
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

  it('answers a stored draft whose canonicalize floods one warning with 20 of them and one I_FINDINGS_TRUNCATED', async () => {
    const flood = Array.from({ length: 120 }, (_, index) => ({
      code: 'W_CANON_UNRESOLVED_ID' as const,
      severity: 'warning' as const,
      message: `Table gone-${index} no longer exists.`,
    }))
    mocks.read.mockResolvedValue({ ...source, diagnostics: flood })

    const response = await GET(request(), context)
    const { data } = await response.json()

    expect(response.status).toBe(200)
    const codes = data.diagnostics.map((finding: { code: string }) => finding.code)
    expect(codes.filter((code: string) => code === 'W_CANON_UNRESOLVED_ID')).toHaveLength(20)
    expect(codes.filter((code: string) => code === 'I_FINDINGS_TRUNCATED')).toHaveLength(1)
  })

  it('passes functionCode through, omitting it when absent', async () => {
    await GET(request('?functionCode=inline'), context)
    await GET(request(), context)

    expect(mocks.read.mock.calls[0][0].input).toEqual({
      workflowId: WORKFLOW_ID,
      functionCode: 'inline',
    })
    expect(mocks.read.mock.calls[1][0].input).toEqual({ workflowId: WORKFLOW_ID })
  })

  it.each(['?functionCode=ts', '?annotateIds=true'])(
    'rejects %s with 400 before reading the workflow',
    async (query) => {
      const response = await GET(request(query), context)

      expect(response.status).toBe(400)
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

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

const applyBody = {
  files: source.files,
  lock: source.lock,
  base: source.base,
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
    variables: { added: [], removed: [], renamed: [], modified: [] },
  },
  diagnostics: [],
  files: source.files,
  lock: source.lock,
  base: source.base,
  mintedIds: {},
  notes: [],
  needsRedeployment: true,
  sdkMajor: 1,
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
      code: 'E_APPLY_LOCKED_BLOCK' as const,
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

  it('answers a flood of one warning as 20 of them and one I_FINDINGS_TRUNCATED, in place of the compile’s', async () => {
    const flood = Array.from({ length: 120 }, (_, index) => ({
      code: 'W_CANON_UNRESOLVED_ID' as const,
      severity: 'warning' as const,
      message: `Table gone-${index} no longer exists.`,
    }))
    const compileMarker = {
      code: 'I_FINDINGS_TRUNCATED' as const,
      severity: 'info' as const,
      message: 'Listed 20 W_UNRESOLVED_REF warnings; the rest of them are omitted.',
    }
    mocks.apply.mockResolvedValue({ ...applied, diagnostics: [compileMarker, ...flood] })

    const response = await POST(applyRequest(applyBody), context)
    const { data } = await response.json()

    expect(response.status).toBe(200)
    const codes = data.diagnostics.map((finding: { code: string }) => finding.code)
    expect(codes.filter((code: string) => code === 'W_CANON_UNRESOLVED_ID')).toHaveLength(20)
    expect(codes.filter((code: string) => code === 'I_FINDINGS_TRUNCATED')).toHaveLength(1)
    expect(data.diagnostics.at(-1).message).toContain('There are 120 findings; 100 more')
  })

  it('answers a refusal with more errors than one answer lists as the first 100 and one that counts the rest', async () => {
    const errors = Array.from({ length: 150 }, (_, index) => ({
      code: 'E_UNKNOWN_IDENTIFIER' as const,
      severity: 'error' as const,
      message: `Unknown identifier t${index}.`,
    }))
    mocks.apply.mockRejectedValue(new WorkflowSourceRejectedError(errors))

    const response = await POST(applyRequest(applyBody), context)
    const body = await response.json()

    expect(response.status).toBe(400)
    const listed = body.error.details.diagnostics
    expect(listed).toHaveLength(101)
    expect(listed.at(-1)).toMatchObject({
      code: 'I_FINDINGS_TRUNCATED',
      message: expect.stringContaining('50 more (50 of them errors)'),
    })
  })

  it('answers 409 with the current fingerprint when the draft moved', async () => {
    const current = `sf1:${'f'.repeat(64)}`
    mocks.apply.mockRejectedValue(new WorkflowSourceStaleError(current, 'Lead Scoring'))

    const response = await POST(applyRequest(applyBody), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details).toEqual({ code: 'SOURCE_STALE', currentFingerprint: current })
  })

  it('answers 409 with SOURCE_NAME_TAKEN when a rename lands on a name taken meanwhile', async () => {
    mocks.apply.mockRejectedValue(new WorkflowSourceNameTakenError('Triage'))

    const response = await POST(applyRequest(applyBody), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details).toEqual({ code: 'SOURCE_NAME_TAKEN', name: 'Triage' })
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

  it('refuses a provenance repo carrying credentials in any form before applying, so none reaches the audit log', async () => {
    const credentialed = [
      'https://x-access-token:ghp_x@github.com/a/b.git',
      'https://ghp_x@github.com/a/b.git',
      ' https://ghp_x@github.com/a/b.git',
      '\thttps://ghp_x@github.com/a/b.git',
      'git+https://ghp_x@github.com/a/b.git',
      'https://github.com/a/b.git?access_token=ghp_x',
      'https://u:pa/ss@github.com/a/b.git',
      'ssh://git:secret@github.com/a/b.git',
      'user:secret@github.com:a/b.git',
      'https:/ghp_x@github.com/a/b.git',
      'https:ghp_x@github.com/a/b.git',
      'https://github.com/a/b.git#ghp_x',
      'git@github.com:a/b.git#ghp_x',
    ]
    for (const repo of credentialed) {
      const response = await POST(
        applyRequest({ ...applyBody, provenance: { client: 'cli', repo } }),
        context
      )
      expect({ repo, status: response.status }).toEqual({ repo, status: 400 })
    }
    expect(mocks.apply).not.toHaveBeenCalled()

    for (const repo of [
      'https://github.com/a/b.git',
      'ssh://git@github.com/a/b.git',
      'git@github.com:a/b.git',
    ]) {
      const response = await POST(
        applyRequest({ ...applyBody, provenance: { client: 'cli', repo } }),
        context
      )
      expect({ repo, status: response.status }).toEqual({ repo, status: 200 })
    }
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

  it('passes dryRun through as a boolean', async () => {
    mocks.apply.mockResolvedValue({ ...applied, dryRun: true, applied: false })

    const response = await POST(applyRequest(applyBody, '?dryRun=true'), context)

    expect(response.status).toBe(200)
    expect(mocks.apply.mock.calls[0][0].input).toMatchObject({
      workflowId: WORKFLOW_ID,
      dryRun: true,
    })
    expect((await response.json()).data.applied).toBe(false)
  })

  it('rejects a base without workflowId with 400 before applying', async () => {
    const { workflowId: _omitted, ...base } = source.base
    const response = await POST(applyRequest({ ...applyBody, base }), context)

    expect(response.status).toBe(400)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})

/**
 * One token bucket per limiter key, as the limiter keeps one per subject and bucket name, so a
 * route's budget is whatever config it charges and whichever key it charges it to.
 */
function meterOperationBuckets() {
  const spent = new Map<string, number>()
  v2RouteMocks.operationRate.mockImplementation(
    async (key: string, config: { maxTokens: number }, cost = 1) => {
      const used = (spent.get(key) ?? 0) + cost
      spent.set(key, used)
      return {
        allowed: used <= config.maxTokens,
        remaining: Math.max(0, config.maxTokens - used),
        resetAt: new Date('2026-01-01T01:00:00.000Z'),
        retryAfterMs: 60_000,
      }
    }
  )
}

/** The generic v2 budget the rate-limiter mock gives every plan. */
const GENERIC_BUDGET = v2RateLimiterModuleMock.getRateLimit().maxTokens

async function writesUntilLimited(write: () => Promise<Response>): Promise<number | null> {
  for (let sent = 1; sent <= GENERIC_BUDGET; sent += 1) {
    if ((await write()).status === 429) return sent
  }
  return null
}

describe('source write rate limit', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    meterOperationBuckets()
    mocks.read.mockResolvedValue(source)
    mocks.apply.mockResolvedValue({ ...applied, dryRun: true, applied: false })
    mocks.create.mockResolvedValue({ ...applied, dryRun: true, applied: false })
  })

  it('answers 429 to dry runs well inside the generic budget, while reads still answer', async () => {
    const limitedAt = await writesUntilLimited(() =>
      POST(applyRequest(applyBody, '?dryRun=true'), context)
    )

    expect(limitedAt).not.toBeNull()
    expect(limitedAt).toBeLessThan(GENERIC_BUDGET)
    expect((await GET(request(), context)).status).toBe(200)
  })

  it('runs dry runs in plan slots, never in an apply’s: past the plans this server runs at once a dry run answers 429 and a real apply still runs', async () => {
    const finish: Array<() => void> = []
    mocks.apply.mockImplementation(({ input }: { input: { dryRun?: boolean } }) =>
      input.dryRun
        ? new Promise((resolve) => finish.push(() => resolve({ ...applied, dryRun: true })))
        : Promise.resolve(applied)
    )
    const dryRun = () => POST(applyRequest(applyBody, '?dryRun=true'), context)
    const running = Array.from({ length: 4 }, () => dryRun())
    await vi.waitFor(() => expect(finish).toHaveLength(4))

    const refused = await dryRun()
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe('5')
    expect((await POST(applyRequest(applyBody), context)).status).toBe(200)

    for (const done of finish) done()
    expect((await Promise.all(running)).map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ])
  })

  it('answers 429 with Retry-After to a get past the gets this server runs at once', async () => {
    const finish: Array<() => void> = []
    mocks.read.mockImplementation(
      () => new Promise((resolve) => finish.push(() => resolve(source)))
    )
    const running = Array.from({ length: 4 }, () => GET(request(), context))
    await vi.waitFor(() => expect(finish).toHaveLength(4))

    const refused = await GET(request(), context)
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe('5')

    for (const done of finish) done()
    expect((await Promise.all(running)).map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ])
  })

  it('charges an apply and a create from source to one budget', async () => {
    await writesUntilLimited(() => POST(applyRequest(applyBody), context))

    const response = await CREATE(
      new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source`, {
        method: 'POST',
        headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
        body: JSON.stringify({ files: source.files }),
      }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
    )

    expect(response.status).toBe(429)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('source plan budget', () => {
  const person = {
    ...auth,
    principal: {
      kind: 'personal_api_key' as const,
      userId: 'user-1',
      keyId: 'key-2',
      access: 'write' as const,
    },
    rateLimitSubjectIds: ['api-key:key-2', 'user:user-1'] as const,
    keyType: 'personal' as const,
  }
  const plan = () =>
    PLAN(
      new NextRequest(`http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/source/plan`, {
        method: 'POST',
        headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
        body: JSON.stringify(applyBody),
      }),
      context
    )

  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(person)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    meterOperationBuckets()
    mocks.plan.mockResolvedValue({ ...applied, dryRun: true, applied: false })
    mocks.apply.mockResolvedValue({ ...applied, dryRun: true, applied: false })
  })

  it('answers 429 to plans well inside the generic budget, and dry-run applies and creates share it, never the write budget', async () => {
    mocks.apply.mockResolvedValue(applied)
    mocks.create.mockResolvedValue(applied)
    const create = (query: string) =>
      CREATE(
        new NextRequest(
          `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source${query}`,
          {
            method: 'POST',
            headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
            body: JSON.stringify({ files: source.files }),
          }
        ),
        { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
      )
    const limitedAt = await writesUntilLimited(plan)

    expect(limitedAt).not.toBeNull()
    expect(limitedAt).toBeLessThan(GENERIC_BUDGET)
    expect((await POST(applyRequest(applyBody, '?dryRun=true'), context)).status).toBe(429)
    expect((await create('?dryRun=true')).status).toBe(429)
    expect((await POST(applyRequest(applyBody), context)).status).not.toBe(429)
    expect((await create('')).status).not.toBe(429)
  })

  it('answers 429 with Retry-After to a plan past the plans this server runs at once', async () => {
    const finish: Array<() => void> = []
    mocks.plan.mockImplementation(
      () => new Promise((resolve) => finish.push(() => resolve({ ...applied, dryRun: true })))
    )
    const running = Array.from({ length: 4 }, () => plan())
    await vi.waitFor(() => expect(finish).toHaveLength(4))

    const refused = await plan()
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe('5')

    for (const done of finish) done()
    expect((await Promise.all(running)).map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ])
  })
})
