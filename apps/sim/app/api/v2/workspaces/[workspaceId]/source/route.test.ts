import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apply: vi.fn(), read: vi.fn(), authorizeRead: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workspace-source/application/apply-workspace-source', () => ({
  applyWorkspaceSource: { operation: { id: 'workspaces.source.apply' }, execute: mocks.apply },
}))
vi.mock('@/lib/workspace-source/application/read-workspace-source', () => ({
  readWorkspaceSource: {
    operation: { id: 'workspaces.source.read' },
    authorize: mocks.authorizeRead,
    execute: mocks.read,
  },
}))

import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import type { WorkspaceSourceDiagnostic } from '@/lib/workspace-source/application/types'
import { GET, POST } from '@/app/api/v2/workspaces/[workspaceId]/source/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

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

function apply(
  query = '',
  files: Record<string, string> = {
    'workflows/a/workflow.ts': "// @sim-sdk 1\nexport default workflow('A', () => {})\n",
  }
) {
  return POST(
    new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/source${query}`, {
      method: 'POST',
      headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
      body: JSON.stringify({ files, kinds: ['workflow'] }),
    }),
    { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
  )
}

/** `count` errors of one workflow folder, as a plan refusal pins them to it. */
function folderErrors(count: number): WorkspaceSourceDiagnostic[] {
  return Array.from({ length: count }, (_, index) => ({
    code: 'E_UNKNOWN_IDENTIFIER' as const,
    severity: 'error' as const,
    message: `Unknown identifier t${index}.`,
    file: 'workflows/a/workflow.ts',
    kind: 'workflow' as const,
    key: 'a',
  }))
}

describe('POST /api/v2/workspaces/{workspaceId}/source', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  })

  it('charges a dry run, which writes nothing, to the plan bucket per folder sent, and a real apply to the write bucket', async () => {
    mocks.apply.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      dryRun: true,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: { version: 1, workspaceId: WORKSPACE_ID, resources: {} },
      diagnostics: [],
    })
    const folders = Object.fromEntries(
      Array.from({ length: 61 }, (_, index) => [
        `workflows/w${index}/workflow.ts`,
        "// @sim-sdk 1\nexport default workflow('W', () => {})\n",
      ])
    )
    const charges = () =>
      v2RouteMocks.operationRate.mock.calls
        .filter(([key]) => String(key).endsWith(':api-key:key-1'))
        .map(([key, , cost]) => `${String(key).split(':')[1]} ${cost}`)

    expect((await apply('?dryRun=true', folders)).status).toBe(200)
    expect(charges()).toEqual(['source.plan 1', 'source.plan 39'])

    v2RouteMocks.operationRate.mockClear()
    expect((await apply('', folders)).status).toBe(200)
    expect(charges()).toEqual(['workflows.source.write 1', 'workflows.source.write 39'])
  })

  it('runs dry runs in plan slots, never in an apply’s: past the plans this server runs at once a dry run answers 429 and a real apply still runs', async () => {
    const result = {
      workspaceId: WORKSPACE_ID,
      dryRun: true,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: { version: 1, workspaceId: WORKSPACE_ID, resources: {} },
      diagnostics: [],
    }
    const finish: Array<() => void> = []
    mocks.apply.mockImplementation(({ input }: { input: { dryRun?: boolean } }) =>
      input.dryRun
        ? new Promise((resolve) => finish.push(() => resolve(result)))
        : Promise.resolve({ ...result, dryRun: false })
    )
    const running = Array.from({ length: 4 }, () => apply('?dryRun=true'))
    await vi.waitFor(() => expect(finish).toHaveLength(4))

    expect((await apply('?dryRun=true')).status).toBe(429)
    expect((await apply('')).status).toBe(200)

    for (const done of finish) done()
    expect((await Promise.all(running)).map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ])
  })

  it('answers a plan refused before any write with at most 1000 findings, and one that counts the rest', async () => {
    mocks.apply.mockRejectedValue(new WorkspaceSourceRejectedError(folderErrors(1_500)))

    const response = await apply()
    const body = await response.json()

    expect(response.status).toBe(400)
    const listed = body.error.details.diagnostics
    expect(listed).toHaveLength(1_001)
    expect(listed.at(-1)).toMatchObject({
      code: 'I_FINDINGS_TRUNCATED',
      severity: 'info',
      message: expect.stringContaining('500 more (500 of them errors)'),
    })
  })

  it('answers an apply with at most 1000 findings, however many its writes added', async () => {
    mocks.apply.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      dryRun: false,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: { version: 1, workspaceId: WORKSPACE_ID, resources: {} },
      diagnostics: Array.from({ length: 1_200 }, (_, index) => ({
        code: 'W_CANON_UNRESOLVED_ID' as const,
        severity: 'warning' as const,
        message: `Table gone-${index} no longer exists.`,
        kind: 'workflow' as const,
        key: `w${index}`,
      })),
    })

    const response = await apply()
    const { data } = await response.json()

    expect(response.status).toBe(200)
    expect(data.diagnostics).toHaveLength(1_001)
    expect(data.diagnostics.at(-1)).toMatchObject({ code: 'I_FINDINGS_TRUNCATED' })
  })
})

/** `count` warnings, one per workflow, as a stored workspace whose tables are gone reads. */
function unresolvedWarnings(count: number): WorkspaceSourceDiagnostic[] {
  return Array.from({ length: count }, (_, index) => ({
    code: 'W_CANON_UNRESOLVED_ID' as const,
    severity: 'warning' as const,
    message: `Table gone-${index} no longer exists.`,
    kind: 'workflow' as const,
    key: `w${index}`,
  }))
}

describe('GET /api/v2/workspaces/{workspaceId}/source', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
  })

  it('answers a read with at most 1000 findings, however many its workflows hold', async () => {
    mocks.read.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      kinds: ['workflow'],
      files: {},
      blobs: [],
      base: { version: 1, workspaceId: WORKSPACE_ID, resources: {} },
      skipped: [],
      diagnostics: unresolvedWarnings(1_200),
    })

    const response = await GET(
      new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/source`, {
        headers: { 'x-api-key': 'key' },
      }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
    )
    const { data } = await response.json()

    expect(response.status).toBe(200)
    expect(data.diagnostics).toHaveLength(1_001)
    expect(data.diagnostics.at(-1)).toMatchObject({ code: 'I_FINDINGS_TRUNCATED' })
  })
})
