import { jsonResponse } from '@sim/testing/helpers/http'
import {
  selectorCredentialsMock,
  selectorCredentialsMockFns,
} from '@sim/testing/mocks/selector-credentials.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { powerBISelectorAttachments } from '@/lib/selectors/server/providers/powerbi'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
import { buildCanonicalIndexForSurface } from '@/lib/workflows/subblocks/visibility'
import { PowerBIBlock } from '@/blocks/blocks/powerbi'

vi.mock('@/lib/selectors/server/credentials', () => selectorCredentialsMock)

function args(overrides: Partial<ExecuteServerSelectorArgs> = {}): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'powerbi.workspaces',
    context: { oauthCredential: 'powerbi-credential', groupId: 'workspace-one' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'sim-workspace' },
    workspaceId: 'sim-workspace',
    principal: { kind: 'session', userId: 'user-one', sessionId: 'session-one' },
    requesterUserId: 'user-one',
    credential: { suppliedId: 'powerbi-credential', providerId: 'microsoft-powerbi' },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
    ...overrides,
  }
}

describe('Power BI selector provider boundary', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    selectorCredentialsMockFns.mockResolveSelectorOAuthAccessToken.mockResolvedValue(
      'powerbi-test-token'
    )
  })

  it('advances numeric workspace offsets one page at a time and ends on a short page', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        value: Array.from({ length: 100 }, (_, index) => ({
          id: `workspace-${index}`,
          name: `Workspace ${index}`,
          token: 'provider-secret',
        })),
        '@odata.nextLink': 'https://untrusted.example/continue',
      })
    )
    const first = await powerBISelectorAttachments['powerbi.workspaces'].execute(
      args({ request: { kind: 'list', cursor: '0' } })
    )
    expect(first).toEqual({
      kind: 'list',
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `workspace-${index}`,
        label: `Workspace ${index}`,
      })),
      nextCursor: '100',
    })
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ value: [{ id: 'workspace-last', name: 'Last workspace' }] })
    )
    const last = await powerBISelectorAttachments['powerbi.workspaces'].execute(
      args({ request: { kind: 'list', cursor: first.kind === 'list' ? first.nextCursor : '' } })
    )
    expect(last).toEqual({
      kind: 'list',
      items: [{ id: 'workspace-last', label: 'Last workspace' }],
    })
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)))
    expect(urls.map((url) => url.origin)).toEqual([
      'https://api.powerbi.com',
      'https://api.powerbi.com',
    ])
    expect(urls.map((url) => url.searchParams.get('$skip'))).toEqual(['0', '100'])
    expect(urls.map((url) => url.searchParams.get('$top'))).toEqual(['100', '100'])
  })

  it.each(['-1', '1.5', '01', '2147483648', '9007199254740993', 'https://evil.example/page'])(
    'rejects a noncanonical or out-of-range offset: %s',
    async (cursor) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }))
      await expect(
        powerBISelectorAttachments['powerbi.workspaces'].execute(
          args({ request: { kind: 'list', cursor } })
        )
      ).rejects.toMatchObject({ name: 'SelectorContextUnavailableError' })
    }
  )

  it.each(['datasets', 'reports'] as const)(
    'binds the %s list to an encoded workspace and exposes only resource IDs and names',
    async (kind) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: 'resource-id', name: 'Readable resource', accessToken: 'must-not-escape' }],
        })
      )
      const key = `powerbi.${kind}` as const
      const result = await powerBISelectorAttachments[key].execute(
        args({
          selectorKey: key,
          context: { oauthCredential: 'powerbi-credential', groupId: ' group#one ' },
        })
      )
      expect(result).toEqual({
        kind: 'list',
        items: [{ id: 'resource-id', label: 'Readable resource' }],
      })
      const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
      expect(url.pathname).toBe(`/v1.0/myorg/groups/group%23one/${kind}`)
      expect(url.search).toBe('')
    }
  )

  it.each([
    ['basic', 'workspaceSelector', 'workspace-basic'],
    ['advanced', 'manualWorkspaceId', '{{POWERBI_WORKSPACE}}'],
  ] as const)(
    'uses the active %s workspace value for semantic-model selector context',
    async (mode, field, workspace) => {
      const values = {
        operation: 'powerbi_execute_query',
        credential: 'powerbi-credential',
        manualCredential: 'stale-credential',
        workspaceSelector: 'stale-workspace',
        manualWorkspaceId: 'stale-manual-workspace',
        [field]: workspace,
      }
      const picker = PowerBIBlock.subBlocks.find((subBlock) => subBlock.id === 'datasetSelector')
      if (!picker) throw new Error('Power BI block has no datasetSelector')
      const context = buildSelectorContextFromValues({
        selectorKey: 'powerbi.datasets',
        contextConfigs: getSelectorContextSubBlocks(PowerBIBlock.subBlocks, values),
        values,
        dependsOn: getDependsOnFields(picker.dependsOn),
        canonicalIndex: buildCanonicalIndexForSurface(PowerBIBlock.subBlocks, false),
        canonicalModes: { groupId: mode },
      })
      expect(context).toEqual({ oauthCredential: 'powerbi-credential', groupId: workspace })
      if (mode === 'basic') {
        fetchMock.mockResolvedValueOnce(
          jsonResponse({ value: [{ id: 'model-id', name: 'KPI model' }] })
        )
        const result = await powerBISelectorAttachments['powerbi.datasets'].execute(
          args({ selectorKey: 'powerbi.datasets', context })
        )
        expect(result).toEqual({ kind: 'list', items: [{ id: 'model-id', label: 'KPI model' }] })
        expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
          '/v1.0/myorg/groups/workspace-basic/datasets'
        )
      }
    }
  )

  it.each(['workspaces', 'datasets', 'reports'] as const)(
    'resolves a saved %s selection through one direct encoded provider request',
    async (kind) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 'resource#id',
          name: 'Saved resource',
          rawProviderSecret: 'must-not-escape',
        })
      )
      const key = `powerbi.${kind}` as const
      expect(
        await powerBISelectorAttachments[key].execute(
          args({ selectorKey: key, request: { kind: 'detail', id: ' resource#id ' } })
        )
      ).toEqual({ kind: 'detail', item: { id: 'resource#id', label: 'Saved resource' } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
      expect(url.origin).toBe('https://api.powerbi.com')
      expect(url.pathname).toBe(
        kind === 'workspaces'
          ? '/v1.0/myorg/groups/resource%23id'
          : `/v1.0/myorg/groups/workspace-one/${kind}/resource%23id`
      )
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    }
  )

  it.each(['workspaces', 'datasets'] as const)(
    'returns no detail for a deleted %s selection',
    async (kind) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
      const key = `powerbi.${kind}` as const
      expect(
        await powerBISelectorAttachments[key].execute(
          args({ selectorKey: key, request: { kind: 'detail', id: 'removed-resource' } })
        )
      ).toEqual({ kind: 'detail', item: null })
    }
  )

  it.each([
    {},
    { value: null },
    { value: [{ id: 'resource' }] },
    { value: [{ id: '', name: 'Resource' }] },
    { value: [{ id: 'resource', name: '' }] },
    {
      value: Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: 'Workspace' })),
    },
  ])('rejects malformed or overfull workspace pages: %j', async (payload) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload))
    await expect(
      powerBISelectorAttachments['powerbi.workspaces'].execute(args())
    ).rejects.toMatchObject({
      name: 'SelectorOptionsUnavailableError',
    })
  })

  it('does not accept a late successful page after cancellation', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async () => {
      controller.abort()
      return jsonResponse({ value: [{ id: 'late', name: 'Late resource' }] })
    })
    await expect(
      powerBISelectorAttachments['powerbi.workspaces'].execute(args({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('propagates cancellation to provider transport', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(async (_url, init) => {
      controller.abort()
      init?.signal?.throwIfAborted()
      return jsonResponse({ value: [] })
    })
    await expect(
      powerBISelectorAttachments['powerbi.workspaces'].execute(args({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
