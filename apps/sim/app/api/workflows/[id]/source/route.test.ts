import { authMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRead } = vi.hoisted(() => ({ mockRead: vi.fn() }))

vi.mock('@/lib/workflows/application/read-workflow-source', () => ({
  readWorkflowSource: {
    operation: {
      id: 'workflows.source.read',
      minimumRole: 'read',
      workspaceApiKey: 'allow',
      principalKinds: ['session', 'personal_api_key', 'workspace_api_key'],
    },
    authorize: vi.fn(async () => {}),
    execute: mockRead,
  },
}))

import { withSourceSlot } from '@/lib/workflows/api/source-slots'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { GET } from '@/app/api/workflows/[id]/source/route'

const WORKFLOW_ID = 'workflow-123'
const FINGERPRINT = `sf1:${'c'.repeat(64)}`

const source = {
  workflowId: WORKFLOW_ID,
  workspaceId: 'workspace-456',
  files: { 'workflow.ts': "// @sim-sdk 1\nexport default workflow('W', () => {})\n" },
  lock: {
    version: 1 as const,
    blocks: { start: { id: 'b-1', parent: null, ident: 'start', order: 0 } },
    variables: {},
  },
  base: {
    version: 1 as const,
    workflowId: WORKFLOW_ID,
    workspaceId: 'workspace-456',
    fingerprint: FINGERPRINT,
    catalogHash: 'h',
  },
  canonicalHash: 'd'.repeat(64),
  sdkMajor: 1,
  blockTypes: ['start_trigger'],
  diagnostics: [],
}

const read = () =>
  GET(new NextRequest(`http://localhost:3000/api/workflows/${WORKFLOW_ID}/source`), {
    params: Promise.resolve({ id: WORKFLOW_ID }),
  })

describe('GET /api/workflows/[id]/source', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-123' },
      session: { id: 'session-123' },
    })
  })

  it('reads in a lane of its own: API and CLI source gets filling theirs never refuse the Code tab', async () => {
    const finish: Array<() => void> = []
    mockRead.mockImplementation(() => new Promise((resolve) => finish.push(() => resolve(source))))
    const apiGet = withSourceSlot(readWorkflowSource, 'read')
    const principal = createSessionPrincipal({ userId: 'user-123', sessionId: 'session-123' })
    const running = Array.from({ length: 4 }, () =>
      apiGet.execute({ principal, input: { workflowId: WORKFLOW_ID } })
    )
    await vi.waitFor(() => expect(finish).toHaveLength(4))
    mockRead.mockResolvedValueOnce(source)

    expect((await read()).status).toBe(200)

    for (const done of finish) done()
    await Promise.all(running)
  })

  it('answers 429 with Retry-After to a read past the source gets this server runs at once', async () => {
    const finish: Array<() => void> = []
    mockRead.mockImplementation(() => new Promise((resolve) => finish.push(() => resolve(source))))
    const running = Array.from({ length: 4 }, () => read())
    await vi.waitFor(() => expect(finish).toHaveLength(4))

    const refused = await read()
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toBe('5')
    expect(mockRead).toHaveBeenCalledTimes(4)

    for (const done of finish) done()
    expect((await Promise.all(running)).map((response) => response.status)).toEqual([
      200, 200, 200, 200,
    ])
  })
})
