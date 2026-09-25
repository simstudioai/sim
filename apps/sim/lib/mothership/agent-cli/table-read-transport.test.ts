import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ scoped: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/mothership/agent-cli/scoped-transport', () => ({
  createScopedCliTransport: () => hoisted.scoped,
}))
vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/execution/remote-sandbox/session-files', () => ({
  SESSION_SANDBOX_HOME: '/home/user',
  readSessionSandboxFile: vi.fn(),
  writeSessionSandboxFile: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/session-file-snapshot', () => ({
  openSessionFileSnapshot: vi.fn(),
}))

import { V2_ROUTES } from '@/lib/api/server/routes/v2-route-table.generated'
import {
  createTableReadTransport,
  TABLE_ROUTES_WITHOUT_ROW_DATA,
} from '@/lib/mothership/agent-cli/table-read-transport'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
import { reportTableRowDelivery } from '@/lib/table/application/row-delivery-observer'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = { ...hoisted, decrypt: encryptionMockFns.mockDecryptSecret }

mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace.mockImplementation(
  async (owner: { userId: string }, workspaceId?: string) => ({
    workspaceId: workspaceId ?? 'workspace',
    userId: owner.userId,
  })
)

const SECRET = 'PRIVATE_TABLE_CELL_CANARY_FOR_LOCAL_TEST'
const scope = { userId: 'reader', workspaceId: 'workspace' }
const endpoint = 'https://sim.test'
const rowUrl = `${endpoint}/api/v2/tables/table/rows/row?workspaceId=workspace`
const rowBody = { data: { id: 'row', data: { token: SECRET } } }

function registry() {
  return new ResolvedSecretTraceRegistry([], scope)
}

function secretProvenance() {
  const source = new ResolvedSecretTraceRegistry(
    [{ name: 'TABLE_SECRET', plaintext: SECRET, encryptedValue: 'fixture-ciphertext' }],
    scope
  )
  source.recordResolved('TABLE_SECRET', SECRET, { propagated: true })
  return source.exportProvenance()
}

/** Stands in for a v2 table route whose use case reports the rows it returns. */
async function deliveringRoute() {
  await reportTableRowDelivery(secretProvenance(), [{ col_token: SECRET }])
  return Response.json(rowBody)
}

function projected(output: string, trace: ResolvedSecretTraceRegistry) {
  return JSON.stringify(inspectToolResultForCopilot({ success: true, output }, trace, 'sim_cli'))
}

describe('table provenance at the CLI and model-result boundary', () => {
  beforeEach(() => {
    mocks.decrypt.mockResolvedValue({ decrypted: SECRET })
  })

  it('activates reported row provenance so the model projection redacts the cell', async () => {
    const trace = registry()
    const inner = vi.fn(deliveringRoute)
    const response = await createTableReadTransport({
      endpoint,
      transport: inner,
      registry: trace,
    })(rowUrl)

    expect(response.status).toBe(200)
    const output = await response.text()
    expect(output).toBe(JSON.stringify(rowBody))
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    expect(projected(output, trace)).not.toContain(SECRET)
  })

  it('withholds a row-bearing result that reported no provenance', async () => {
    const trace = registry()
    const response = await createTableReadTransport({
      endpoint,
      transport: async () => Response.json(rowBody),
      registry: trace,
    })(rowUrl)

    expect(response.status).toBe(200)
    expect(trace.isPermanentlyIncomplete()).toBe(true)
    expect(projected(await response.text(), trace)).not.toContain(SECRET)
  })

  it('withholds a result whose run state carries error text without provenance', async () => {
    const trace = registry()
    const response = await createTableReadTransport({
      endpoint,
      transport: async () => {
        await reportTableRowDelivery(secretProvenance(), [{ col_token: SECRET }], {
          unprovenancedErrorText: true,
        })
        return Response.json(rowBody)
      },
      registry: trace,
    })(rowUrl)

    expect(response.status).toBe(200)
    expect(trace.isPermanentlyIncomplete()).toBe(true)
    expect(trace.getIncompletenessDiagnostics()?.reasons).toEqual([
      'table-run-state-provenance-unavailable',
    ])
  })

  it('keeps a delivered result without run-state error text complete', async () => {
    const trace = registry()
    await createTableReadTransport({
      endpoint,
      transport: async () => {
        await reportTableRowDelivery(secretProvenance(), [{ col_token: SECRET }], {
          unprovenancedErrorText: false,
        })
        return Response.json(rowBody)
      },
      registry: trace,
    })(rowUrl)

    expect(trace.isPermanentlyIncomplete()).toBe(false)
  })

  it.each(['GET', 'HEAD'])(
    'refuses to return a table export download link (%s)',
    async (method) => {
      const trace = registry()
      const inner = vi.fn(async () =>
        Response.json({ data: { url: 'https://signed.test/export.csv' } })
      )
      const response = await createTableReadTransport({
        endpoint,
        transport: inner,
        registry: trace,
      })(`${endpoint}/api/v2/tables/table/exports/export/download?workspaceId=workspace`, {
        method,
      })

      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('signed.test')
      expect(inner).not.toHaveBeenCalled()
      expect(trace.isPermanentlyIncomplete()).toBe(false)
    }
  )

  it('ignores provenance that detached work reports after the call settles', async () => {
    const trace = registry()
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let detached: Promise<void> | undefined
    await createTableReadTransport({
      endpoint,
      transport: async () => {
        detached = released.then(() =>
          reportTableRowDelivery(secretProvenance(), [{ col_token: SECRET }])
        )
        return Response.json({ error: { message: 'Row not found' } }, { status: 404 })
      },
      registry: trace,
    })(rowUrl)

    release()
    await detached
    expect(projected(JSON.stringify(rowBody), trace)).toContain(SECRET)
  })

  it('refuses row reads without a registry instead of returning plaintext', async () => {
    const inner = vi.fn(deliveringRoute)
    const response = await createTableReadTransport({ endpoint, transport: inner })(rowUrl)

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(SECRET)
    expect(inner).not.toHaveBeenCalled()
  })

  it('keeps a failed row read from poisoning the turn', async () => {
    const trace = registry()
    const response = await createTableReadTransport({
      endpoint,
      transport: async () =>
        Response.json({ error: { message: 'Row not found' } }, { status: 404 }),
      registry: trace,
    })(rowUrl)

    expect(response.status).toBe(404)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
  })

  it.each([
    ['GET', `${endpoint}/api/v2/files/file?workspaceId=workspace`],
    ['GET', `${endpoint}/api/v2/tables/table?workspaceId=workspace`],
    ['POST', `${endpoint}/api/v2/tables/table/rows/search`],
    ['DELETE', `${endpoint}/api/v2/tables/table/rows/row?workspaceId=workspace`],
    ['GET', 'https://elsewhere.test/api/v2/tables/table/rows/row'],
  ])('passes %s %s through untouched without a registry', async (method, url) => {
    const upstream = Response.json({ data: { ok: true } })
    const inner = vi.fn(async () => upstream)
    const response = await createTableReadTransport({ endpoint, transport: inner })(url, {
      method,
    })

    expect(response).toBe(upstream)
    expect(inner).toHaveBeenCalledWith(url, { method })
  })

  it('composes into the sim_cli stack so a table read through the real CLI is redacted', async () => {
    mocks.scoped.mockImplementation(deliveringRoute)
    const trace = registry()
    const result = await executeSimCli(
      {
        request: {
          invocation: {
            kind: 'cli',
            argv: ['tables', 'rows', 'get', 'table', 'row'],
          },
        },
      },
      {
        userId: 'reader',
        workspaceId: 'workspace',
        workflowId: '',
        chatId: 'chat',
        resolvedSecretTraceRegistry: trace,
      }
    )

    expect(mocks.scoped).toHaveBeenCalled()
    expect(new URL(String(mocks.scoped.mock.calls[0]?.[0])).pathname).toBe(
      '/api/v2/tables/table/rows/row'
    )
    expect(JSON.stringify(result.output)).toContain(SECRET)
    expect(trace.isPermanentlyIncomplete()).toBe(false)
    expect(JSON.stringify(inspectToolResultForCopilot(result, trace, 'sim_cli'))).not.toContain(
      SECRET
    )
  })

  /**
   * Every v2 table route is either declared row-free or must deliver provenance.
   * A new route lands in the row-bearing set by default — its results are withheld
   * until its use case reports delivery — and this list forces that to be a decision.
   */
  it('classifies every v2 table route', async () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
    const declared = new Set<string>()
    for (const route of V2_ROUTES) {
      if (route.pattern !== '/api/v2/tables' && !route.pattern.startsWith('/api/v2/tables/'))
        continue
      const module = await route.load()
      for (const method of methods) {
        if (typeof Reflect.get(module, method) === 'function')
          declared.add(`${method} ${route.pattern}`)
      }
    }

    expect([...TABLE_ROUTES_WITHOUT_ROW_DATA].filter((key) => !declared.has(key))).toEqual([])
    expect([...declared].filter((key) => !TABLE_ROUTES_WITHOUT_ROW_DATA.has(key)).sort()).toEqual([
      'GET /api/v2/tables/{tableId}/exports/{exportId}/download',
      'GET /api/v2/tables/{tableId}/rows',
      'GET /api/v2/tables/{tableId}/rows/{rowId}',
      'GET /api/v2/tables/{tableId}/rows/{rowId}/enrichment/{groupId}',
      'PATCH /api/v2/tables/{tableId}/rows/{rowId}',
      'POST /api/v2/tables/{tableId}/query',
      'POST /api/v2/tables/{tableId}/rows',
      'POST /api/v2/tables/{tableId}/rows/upsert',
    ])
  }, 60_000)
})
