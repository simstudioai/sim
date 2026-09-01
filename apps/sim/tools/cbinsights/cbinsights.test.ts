/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeCbinsightsChatOperation } from '@/lib/internal/cbinsights/operations/chat'
import { executeCbinsightsGetCommercialMaturityHistoryOperation } from '@/lib/internal/cbinsights/operations/get-commercial-maturity-history'
import { executeCbinsightsGetExitProbabilityHistoryOperation } from '@/lib/internal/cbinsights/operations/get-exit-probability-history'
import { executeCbinsightsGetOrgFundingsOperation } from '@/lib/internal/cbinsights/operations/get-org-fundings'
import { executeCbinsightsGetOrgOutlookOperation } from '@/lib/internal/cbinsights/operations/get-org-outlook'
import { executeCbinsightsListBusinessRelationshipsOperation } from '@/lib/internal/cbinsights/operations/list-business-relationships'
import { executeCbinsightsListFundingsOperation } from '@/lib/internal/cbinsights/operations/list-fundings'
import { executeCbinsightsLookupOrganizationsOperation } from '@/lib/internal/cbinsights/operations/lookup-organizations'
import { executeCbinsightsRagOperation } from '@/lib/internal/cbinsights/operations/rag'
import { executeCbinsightsSearchFirmographicsOperation } from '@/lib/internal/cbinsights/operations/search-firmographics'
import { cbinsightsChatTool } from '@/tools/cbinsights/chat'
import { cbinsightsGetScoutingReportTool } from '@/tools/cbinsights/get_scouting_report'
import { cbinsightsListBusinessRelationshipsTool } from '@/tools/cbinsights/list_business_relationships'
import { cbinsightsRagTool } from '@/tools/cbinsights/rag'
import { cbinsightsSearchFirmographicsTool } from '@/tools/cbinsights/search_firmographics'
import { cbInsightsTokenCacheSize, resetCbInsightsTokenCache } from '@/tools/cbinsights/utils'

const CREDS = { clientId: 'id', clientSecret: 'secret' }

interface Call {
  url: string
  init: RequestInit
}

let calls: Call[] = []

/** Queues responses in order; each fetch shifts the next one. */
function mockFetch(responses: Array<{ status?: number; body?: unknown; text?: string }>) {
  const queue = [...responses]
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = queue.shift()
    if (!next) throw new Error(`unexpected fetch to ${String(url)}`)
    const body = next.text !== undefined ? next.text : JSON.stringify(next.body ?? {})
    return new Response(body, { status: next.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const AUTH_OK = { body: { token: 'jwt-1' } }

beforeEach(() => {
  calls = []
  resetCbInsightsTokenCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cbinsights authorization', () => {
  it('exchanges the client credentials before the data call, then bearers the token', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])

    await executeCbinsightsLookupOrganizationsOperation({
      ...CREDS,
      names: 'CB Insights',
    } as never)

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://api.cbinsights.com/v2/authorize')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    })
    expect(calls[1].url).toBe('https://api.cbinsights.com/v2/organizations')
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-1')
  })

  it('reuses a cached token rather than re-authorizing per call', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }, { body: { orgs: [] } }])

    await executeCbinsightsLookupOrganizationsOperation({ ...CREDS, names: 'a' } as never)
    await executeCbinsightsLookupOrganizationsOperation({ ...CREDS, names: 'b' } as never)

    expect(calls.filter((call) => call.url.endsWith('/v2/authorize'))).toHaveLength(1)
  })

  /*
   * The token's lifetime is undocumented, so expiry cannot be predicted — it has
   * to be discovered. A 401 is the only reliable signal that the cached token
   * died, and without this retry every workflow would fail once per expiry.
   */
  it('re-authorizes once and retries when a cached token has expired', async () => {
    mockFetch([
      AUTH_OK,
      { status: 401, body: { error: 'token expired' } },
      { body: { token: 'jwt-2' } },
      { body: { orgs: [{ orgId: 1 }] } },
    ])

    const result = await executeCbinsightsLookupOrganizationsOperation({
      ...CREDS,
      names: 'CB Insights',
    } as never)

    expect(result.output.orgs).toEqual([{ orgId: 1 }])
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.cbinsights.com/v2/authorize',
      'https://api.cbinsights.com/v2/organizations',
      'https://api.cbinsights.com/v2/authorize',
      'https://api.cbinsights.com/v2/organizations',
    ])
    expect((calls[3].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-2')
  })

  it('gives up after a second 401 rather than retrying forever', async () => {
    mockFetch([
      AUTH_OK,
      { status: 401, body: { error: 'nope' } },
      { body: { token: 'jwt-2' } },
      { status: 401, body: { error: 'still nope' } },
    ])

    await expect(
      executeCbinsightsLookupOrganizationsOperation({ ...CREDS, names: 'a' } as never)
    ).rejects.toThrow(/still nope/)
    expect(calls).toHaveLength(4)
  })

  it('surfaces the error body rather than a bare status', async () => {
    mockFetch([AUTH_OK, { status: 403, body: { error: 'Insufficient credits' } }])

    await expect(
      executeCbinsightsLookupOrganizationsOperation({ ...CREDS, names: 'a' } as never)
    ).rejects.toThrow(/Insufficient credits/)
  })

  it('fails clearly when authorization returns no token', async () => {
    mockFetch([{ body: {} }])

    await expect(
      executeCbinsightsLookupOrganizationsOperation({ ...CREDS, names: 'a' } as never)
    ).rejects.toThrow(/returned no token/)
  })
})

describe('cbinsights token cache', () => {
  /*
   * The cache is process-wide. Without a bound, a long-lived worker serving many
   * CB Insights accounts would grow with the cumulative number of accounts seen.
   */
  it('stays bounded as distinct credential pairs accumulate', async () => {
    const responses = []
    for (let index = 0; index < 200; index++) {
      responses.push({ body: { token: `jwt-${index}` } }, { body: { orgs: [] } })
    }
    mockFetch(responses)

    for (let index = 0; index < 200; index++) {
      await executeCbinsightsLookupOrganizationsOperation({
        clientId: `id-${index}`,
        clientSecret: 'secret',
        names: 'a',
      } as never)
    }

    expect(cbInsightsTokenCacheSize()).toBeLessThanOrEqual(128)
  })
})

describe('cbinsights request building', () => {
  it('rejects a lookup with no search parameter', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsLookupOrganizationsOperation({ ...CREDS } as never)
    ).rejects.toThrow(/at least one of "names", "urls", or "profileUrl"/)
  })

  it('rejects the profileUrl + names combination the API rejects', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsLookupOrganizationsOperation({
        ...CREDS,
        names: 'CB Insights',
        profileUrl: 'https://app.cbinsights.com/profiles/c/jp3o4',
      } as never)
    ).rejects.toThrow(/only one/)
  })

  it('accepts a comma-separated list and a JSON array alike', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }, { body: { orgs: [] } }])

    await executeCbinsightsLookupOrganizationsOperation({
      ...CREDS,
      names: 'CB Insights, Stripe',
    } as never)
    await executeCbinsightsLookupOrganizationsOperation({
      ...CREDS,
      names: '["CB Insights","Stripe"]',
    } as never)

    expect(JSON.parse(String(calls[1].init.body)).names).toEqual(['CB Insights', 'Stripe'])
    expect(JSON.parse(String(calls[2].init.body)).names).toEqual(['CB Insights', 'Stripe'])
  })

  it('clamps limit into the documented 1-100 range', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsLookupOrganizationsOperation({
      ...CREDS,
      names: 'a',
      limit: 5000,
    } as never)
    expect(JSON.parse(String(calls[1].init.body)).limit).toBe(100)
  })

  it('rejects more than 100 organization IDs before spending a round trip', async () => {
    mockFetch([AUTH_OK])
    const orgIds = Array.from({ length: 101 }, (_, index) => index + 1)
    await expect(
      executeCbinsightsListFundingsOperation({ ...CREDS, orgIds } as never)
    ).rejects.toThrow(/at most 100 organization IDs/)
  })

  it('rejects more than 100 firmographics organization IDs before spending a round trip', async () => {
    mockFetch([AUTH_OK])
    const orgIds = Array.from({ length: 101 }, (_, index) => index + 1)
    await expect(
      executeCbinsightsSearchFirmographicsOperation({ ...CREDS, orgIds } as never)
    ).rejects.toThrow(/at most 100 organization IDs/)
    expect(calls).toHaveLength(0)
  })

  it.each([
    ['startDate', 20260725],
    ['endDate', { date: '2026-08-28' }],
  ])('rejects a non-string commercial maturity %s', async (field, value) => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsGetCommercialMaturityHistoryOperation({
        ...CREDS,
        orgId: 129410,
        [field]: value,
      } as never)
    ).rejects.toThrow(new RegExp(`"${field}" must be a string`))
    expect(calls).toHaveLength(0)
  })

  /*
   * Dropping the bad entries instead would run against a silently narrower set:
   * a typo would spend credits on the wrong organizations and still report
   * success. Both reviewers flagged this independently.
   */
  it('rejects a required ID list containing an invalid entry rather than dropping it', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsListFundingsOperation({
        ...CREDS,
        orgIds: '129410, notanid, 1034157',
      } as never)
    ).rejects.toThrow(/must contain only positive integers \(invalid: notanid\)/)
  })

  it('rejects a mistyped optional filter rather than silently widening the search', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsSearchFirmographicsOperation({
        ...CREDS,
        keyword: 'fintech',
        sectorIds: 'four',
      } as never)
    ).rejects.toThrow(/"sectorIds" must contain only positive integers/)
  })

  it('still treats an unset optional filter as absent', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      sectorIds: '',
    } as never)
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ keyword: 'fintech' })
  })

  /*
   * An empty segment is a separator artifact, not a value — dropping it cannot
   * change which organizations are requested. The required and optional paths
   * must agree, or the same typing succeeds on one operation and fails on
   * another.
   */
  it('tolerates a trailing or doubled comma identically on both paths', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }, { body: { orgs: [] } }])

    await executeCbinsightsListFundingsOperation({
      ...CREDS,
      orgIds: '129410, 1034157,',
    } as never)
    expect(JSON.parse(String(calls[1].init.body)).orgIds).toEqual([129410, 1034157])

    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      sectorIds: '1,,2',
    } as never)
    expect(JSON.parse(String(calls[2].init.body)).sectorIds).toEqual([1, 2])
  })

  /*
   * The sibling of the numeric bound. `parseBooleanParam` used to return
   * undefined for anything it did not recognize, so a model answering "yes"
   * dropped the restriction entirely and widened the search — the same failure,
   * on a filter the caller explicitly set.
   */
  it.each(['yes', '1', 'TRUE ish', 0])(
    'rejects the unrecognized boolean %j rather than dropping the filter',
    async (entry) => {
      mockFetch([AUTH_OK])
      await expect(
        executeCbinsightsSearchFirmographicsOperation({
          ...CREDS,
          keyword: 'fintech',
          vcBacked: entry,
        } as never)
      ).rejects.toThrow(/"vcBacked" must be true or false/)
      expect(calls).toHaveLength(0)
    }
  )

  it.each([
    ['true', true],
    ['FALSE', false],
    [true, true],
    [false, false],
  ])('still accepts the boolean form %j a dropdown emits', async (entry, expected) => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      vcBacked: entry,
    } as never)
    expect(JSON.parse(String(calls[1].init.body)).vcBacked).toBe(expected)
  })

  it('treats the dropdown\'s "Any" option as no filter at all', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      vcBacked: '',
    } as never)
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ keyword: 'fintech' })
  })

  /*
   * A mistyped direction used to fold into `desc`, handing back the bottom of a
   * metered result set as though it were the top.
   */
  it('rejects a sort direction that is neither asc nor desc', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsSearchFirmographicsOperation({
        ...CREDS,
        keyword: 'fintech',
        sortField: 'mosaicOverall',
        sortDirection: 'ascending',
      } as never)
    ).rejects.toThrow(/"sortDirection" must be "asc" or "desc"/)
    expect(calls).toHaveLength(0)
  })

  /*
   * `limit` is the last silent-drop path: falling back to the endpoint default
   * returns a different page than the caller asked for, and still bills for it.
   */
  it('rejects a mistyped limit rather than falling back to the endpoint default', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsLookupOrganizationsOperation({
        ...CREDS,
        names: 'a',
        limit: 'twenty',
      } as never)
    ).rejects.toThrow(/"limit" must be a number/)
    expect(calls).toHaveLength(0)
  })

  /*
   * A block-to-block reference can hand over an object. Stringifying it searched
   * for the literal "[object Object]" and reported success on zero matches.
   */
  it('rejects a non-text entry in a free-text filter rather than stringifying it', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsLookupOrganizationsOperation({
        ...CREDS,
        names: [{ name: 'CB Insights' }],
      } as never)
    ).rejects.toThrow(/"names" must contain only text values/)
    expect(calls).toHaveLength(0)
  })

  it('treats a whitespace-only numeric bound as unset, not as zero', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      minCurrentHeadcount: '   ',
    } as never)
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ keyword: 'fintech' })
  })

  it('rejects a mistyped numeric bound rather than dropping it', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsSearchFirmographicsOperation({
        ...CREDS,
        keyword: 'fintech',
        minCurrentHeadcount: 'fifty',
      } as never)
    ).rejects.toThrow(/"minCurrentHeadcount" must be a number/)
  })

  /*
   * The guard measures the filters alone. Paging or sort slipping past it would
   * issue an unfiltered search over the whole database — and still bill for it.
   */
  it('refuses a firmographics search carrying only paging or sort', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsSearchFirmographicsOperation({
        ...CREDS,
        limit: 100,
        nextPageToken: 'tok',
        sortField: 'mosaicOverall',
      } as never)
    ).rejects.toThrow(/at least one search parameter/)
  })

  it('still sends paging and sort alongside a real filter', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      limit: 25,
      nextPageToken: 'tok',
      sortField: 'mosaicOverall',
    } as never)

    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      keyword: 'fintech',
      limit: 25,
      nextPageToken: 'tok',
      sort: { field: 'mosaicOverall', direction: 'desc' },
    })
  })

  /*
   * `Number` reads "0x10" as 16 and "1e2" as 100, so either notation would
   * resolve to a real but unintended organization and bill for it. An ID field
   * should only accept a plain run of digits.
   */
  it.each(['0x10', '1e2', '12.5', 'true', '', ' '])(
    'rejects the alternate numeric notation %j in an ID list',
    async (entry) => {
      mockFetch([AUTH_OK])
      await expect(
        executeCbinsightsGetOrgOutlookOperation({ ...CREDS, orgId: entry } as never)
      ).rejects.toThrow(/"orgId" must be a positive integer/)
    }
  )

  it('rejects a numeric ID past the precision limit on both input shapes', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsGetOrgOutlookOperation({ ...CREDS, orgId: 1e20 } as never)
    ).rejects.toThrow(/"orgId" must be a positive integer/)

    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsGetOrgOutlookOperation({
        ...CREDS,
        orgId: '12345678901234567890',
      } as never)
    ).rejects.toThrow(/"orgId" must be a positive integer/)
  })

  it('still accepts a plain decimal ID, with or without padding', async () => {
    mockFetch([AUTH_OK, { body: {} }, { body: {} }])
    await executeCbinsightsGetOrgOutlookOperation({ ...CREDS, orgId: '  129410  ' } as never)
    expect(calls[1].url).toContain('/organizations/129410/outlook')

    await executeCbinsightsGetOrgOutlookOperation({ ...CREDS, orgId: 129410 } as never)
    expect(calls[2].url).toContain('/organizations/129410/outlook')
  })

  it('rejects an alternate numeric notation inside a bulk ID list', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsListFundingsOperation({
        ...CREDS,
        orgIds: '129410, 0x10',
      } as never)
    ).rejects.toThrow(/must contain only positive integers \(invalid: 0x10\)/)
  })

  it('rejects a non-integer organization ID rather than interpolating it into the path', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsGetOrgOutlookOperation({
        ...CREDS,
        orgId: '12/../../admin',
      } as never)
    ).rejects.toThrow(/"orgId" must be a positive integer/)
  })

  it('puts the organization ID on the path for a scoped endpoint', async () => {
    mockFetch([AUTH_OK, { body: {} }])
    await executeCbinsightsGetOrgFundingsOperation({ ...CREDS, orgId: 129410 } as never)
    expect(calls[1].url).toBe(
      'https://api.cbinsights.com/v2/organizations/129410/financialtransactions/fundings'
    )
  })

  it('omits filters the caller left blank instead of sending them empty', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      marketNames: '',
      minCurrentHeadcount: '',
      sectorIds: '',
    } as never)

    expect(JSON.parse(String(calls[1].init.body))).toEqual({ keyword: 'fintech' })
  })

  it('builds the single sort object from the two plain fields', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [] } }])
    await executeCbinsightsSearchFirmographicsOperation({
      ...CREDS,
      keyword: 'fintech',
      sortField: 'mosaicOverall',
      sortDirection: 'asc',
    } as never)

    expect(JSON.parse(String(calls[1].init.body)).sort).toEqual({
      field: 'mosaicOverall',
      direction: 'asc',
    })
  })

  it('rejects a firmographics search with no filter at all', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsSearchFirmographicsOperation({ ...CREDS } as never)
    ).rejects.toThrow(/at least one search parameter/)
  })

  it('rejects a RAG message over the documented 10,000-character cap', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsRagOperation({ ...CREDS, message: 'x'.repeat(10_001) } as never)
    ).rejects.toThrow(/under 10,000 characters/)
  })
})

describe('cbinsights response mapping', () => {
  it('splits fundings from cap table history and carries the paging envelope', async () => {
    mockFetch([
      AUTH_OK,
      {
        body: {
          fundings: [{ dealId: 1 }],
          capTableHistory: [{ dealId: 1, roundType: 'Angel' }],
          nextPageToken: 'tok',
          totalHits: 42,
          totalHitsRelation: 'eq',
        },
      },
    ])

    const result = await executeCbinsightsGetOrgFundingsOperation({
      ...CREDS,
      orgId: 129410,
    } as never)

    expect(result.output).toEqual({
      fundings: [{ dealId: 1 }],
      capTableHistory: [{ dealId: 1, roundType: 'Angel' }],
      nextPageToken: 'tok',
      totalHits: 42,
      totalHitsRelation: 'eq',
    })
  })

  it('reports absent collections as empty and absent scalars as null', async () => {
    mockFetch([AUTH_OK, { body: {} }])

    const result = await executeCbinsightsGetOrgFundingsOperation({
      ...CREDS,
      orgId: 1,
    } as never)

    expect(result.output).toEqual({
      fundings: [],
      capTableHistory: [],
      nextPageToken: null,
      totalHits: null,
      totalHitsRelation: null,
    })
  })

  /*
   * Business relationships is the one paged endpoint whose documented response
   * carries no total, so the tool must not manufacture a permanently-null
   * `totalHits` alongside the real token.
   */
  it('reports only the fields the business-relationships endpoint documents', async () => {
    mockFetch([AUTH_OK, { body: { orgs: [{ orgId: 1 }], nextPageToken: 'tok' } }])

    const result = await executeCbinsightsListBusinessRelationshipsOperation({
      ...CREDS,
      orgIds: '1',
    } as never)

    expect(result.output).toEqual({ orgs: [{ orgId: 1 }], nextPageToken: 'tok' })
    expect(cbinsightsListBusinessRelationshipsTool.outputs).not.toHaveProperty('totalHits')
    expect(cbinsightsListBusinessRelationshipsTool.outputs).not.toHaveProperty('totalHitsRelation')
  })

  it('renames the API chatID to the block-facing chatId', async () => {
    mockFetch([
      AUTH_OK,
      {
        body: {
          chatID: 'conv-1',
          title: 'Funding growth',
          message: '# Answer',
          sources: [{ sourceIndex: 1 }],
          relatedContent: [{ title: 'x' }],
          suggestions: ['Follow up?'],
        },
      },
    ])

    const result = await executeCbinsightsChatOperation({
      ...CREDS,
      message: 'Which markets are growing?',
    } as never)

    expect(result.output.chatId).toBe('conv-1')
    expect(result.output.message).toBe('# Answer')
    expect(result.output.suggestions).toEqual(['Follow up?'])
  })

  it('sends the conversation ID back under the API name when continuing a chat', async () => {
    mockFetch([AUTH_OK, { body: {} }])
    await executeCbinsightsChatOperation({
      ...CREDS,
      message: 'and then?',
      chatId: 'conv-1',
    } as never)

    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      message: 'and then?',
      chatID: 'conv-1',
    })
  })
})

describe('cbinsights model-input projection', () => {
  /** The operation boundary projects only the message into third-party model input. */
  it('projects only the message on the two generative endpoints', () => {
    const chatSelect = cbinsightsChatTool.operation.modelInput
    const ragSelect = cbinsightsRagTool.operation.modelInput

    expect(chatSelect?.mode).toBe('project')
    expect(ragSelect?.mode).toBe('project')

    const params = { ...CREDS, message: 'secret question', chatId: 'conv-1' }
    expect(chatSelect?.mode === 'project' && chatSelect.select(params as never)).toEqual({
      message: 'secret question',
    })
    expect(ragSelect?.mode === 'project' && ragSelect.select(params as never)).toEqual({
      message: 'secret question',
    })
  })

  /*
   * A Scouting Report is AI-generated, but its only input is an organization ID.
   * A resource ID is not model-visible content, and the skill is explicit that
   * an AI-backed provider is not on its own a reason to project.
   */
  it('leaves the ID-only endpoints unprojected', () => {
    expect(cbinsightsGetScoutingReportTool.operation.modelInput).toBeUndefined()
    expect(cbinsightsSearchFirmographicsTool.operation.modelInput).toBeUndefined()
  })
})

describe('cbinsights non-text runtime values', () => {
  /*
   * `params.x?.trim()` guards `undefined`, not the type: a block-to-block reference
   * resolving to a number reached `.trim()` and threw a bare TypeError naming no
   * parameter. The sibling history operation already used parseOptionalStringParam.
   */
  it('names the offending date parameter instead of throwing a TypeError', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsGetExitProbabilityHistoryOperation({
        ...CREDS,
        orgId: 123,
        startDate: 20240101,
      } as never)
    ).rejects.toThrow('CB Insights "startDate" must be a string')
  })

  it('names a non-text keyword on search rather than crashing', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsSearchFirmographicsOperation({ ...CREDS, keyword: { a: 1 } } as never)
    ).rejects.toThrow('CB Insights "keyword" must be a string')
  })

  it('names a non-text page token rather than crashing', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsListFundingsOperation({
        ...CREDS,
        orgIds: '123',
        nextPageToken: 42,
      } as never)
    ).rejects.toThrow('CB Insights "nextPageToken" must be a string')
  })

  it('still treats a blank optional value as omitted, exactly as before', async () => {
    mockFetch([AUTH_OK, { body: {} }])
    await executeCbinsightsGetExitProbabilityHistoryOperation({
      ...CREDS,
      orgId: 123,
      startDate: '   ',
    } as never)
    expect(JSON.parse(String(calls[1].init.body))).not.toHaveProperty('startDate')
  })
})

describe('cbinsights rag message bound', () => {
  /* The tool description and this error both say "under 10,000", so the guard must
     reject the boundary value rather than forward it. */
  it('rejects a message of exactly 10,000 characters', async () => {
    mockFetch([AUTH_OK])
    await expect(
      executeCbinsightsRagOperation({ ...CREDS, message: 'a'.repeat(10_000) } as never)
    ).rejects.toThrow('CB Insights "message" must be under 10,000 characters')
  })

  it('accepts the largest message the contract allows', async () => {
    mockFetch([AUTH_OK, { body: { data: 'ok' } }])
    await executeCbinsightsRagOperation({ ...CREDS, message: 'a'.repeat(9_999) } as never)
    expect(JSON.parse(String(calls[1].init.body)).message).toHaveLength(9_999)
  })
})
