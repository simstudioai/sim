/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { crunchbaseAutocompleteTool } from '@/tools/crunchbase/autocomplete'
import { crunchbaseGetEntityTool } from '@/tools/crunchbase/get_entity'
import { crunchbaseGetEntityCardTool } from '@/tools/crunchbase/get_entity_card'
import { crunchbaseGetFieldsMetadataTool } from '@/tools/crunchbase/get_fields_metadata'
import { crunchbaseGetOrganizationTool } from '@/tools/crunchbase/get_organization'
import { crunchbaseListDeletedEntitiesTool } from '@/tools/crunchbase/list_deleted_entities'
import { crunchbaseSearchEntitiesTool } from '@/tools/crunchbase/search_entities'
import { crunchbaseSearchOrganizationsTool } from '@/tools/crunchbase/search_organizations'
import { extractErrorMessage } from '@/tools/error-extractors'

const buildUrl = (tool: { request: { url: unknown } }, params: Record<string, unknown>) =>
  (tool.request.url as (p: Record<string, unknown>) => string)(params)

const buildBody = (tool: { request: { body?: unknown } }, params: Record<string, unknown>) =>
  (tool.request.body as (p: Record<string, unknown>) => Record<string, unknown>)(params)

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init })

describe('crunchbase request building', () => {
  it('authenticates with the documented header, not a query param', () => {
    const headers = crunchbaseSearchOrganizationsTool.request.headers({ apiKey: 'secret' } as never)
    expect(headers['X-cb-user-key']).toBe('secret')
    expect(crunchbaseSearchOrganizationsTool.request.url).not.toContain('user_key')
  })

  it('parses a JSON-string query the same as an already-parsed array', () => {
    const predicate = {
      type: 'predicate',
      field_id: 'categories',
      operator_id: 'includes',
      values: ['biotechnology'],
    }
    const fromString = buildBody(crunchbaseSearchOrganizationsTool, {
      apiKey: 'k',
      query: JSON.stringify([predicate]),
    })
    const fromArray = buildBody(crunchbaseSearchOrganizationsTool, {
      apiKey: 'k',
      query: [predicate],
    })

    expect(fromString.query).toEqual([predicate])
    expect(fromString).toEqual(fromArray)
  })

  it('falls back to the collection default field list', () => {
    const body = buildBody(crunchbaseSearchOrganizationsTool, { apiKey: 'k', query: '[]' })
    expect(body.field_ids).toContain('identifier')
    expect(body.field_ids).toContain('num_employees_enum')
    expect(body.limit).toBe(100)
  })

  it('clamps limit into the documented range', () => {
    expect(
      buildBody(crunchbaseSearchOrganizationsTool, { apiKey: 'k', query: '[]', limit: 9000 })
    ).toMatchObject({ limit: 1000 })
    expect(
      buildBody(crunchbaseSearchOrganizationsTool, { apiKey: 'k', query: '[]', limit: '25' })
    ).toMatchObject({ limit: 25 })
  })

  it('rejects a malformed predicate before spending a round trip', () => {
    expect(() =>
      buildBody(crunchbaseSearchOrganizationsTool, {
        apiKey: 'k',
        query: '[{"field_id":"categories"}]',
      })
    ).toThrow(/missing "operator_id"/)

    expect(() =>
      buildBody(crunchbaseSearchOrganizationsTool, { apiKey: 'k', query: 'categories,name' })
    ).toThrow(/must be a JSON array/)
  })

  it('rejects both cursors at once', () => {
    expect(() =>
      buildBody(crunchbaseSearchOrganizationsTool, {
        apiKey: 'k',
        query: '[]',
        afterId: 'a',
        beforeId: 'b',
      })
    ).toThrow(/either "afterId" or "beforeId"/)
  })

  it('requires an explicit field list on the generic search', () => {
    expect(() =>
      buildBody(crunchbaseSearchEntitiesTool, { apiKey: 'k', collection: 'events', query: '[]' })
    ).toThrow(/"fieldIds" is required/)
  })

  it('rejects a collection the API does not publish', () => {
    expect(() =>
      buildUrl(crunchbaseSearchEntitiesTool, { apiKey: 'k', collection: 'unicorns', query: '[]' })
    ).toThrow(/"collection" must be one of/)
  })

  it('sends field_ids and card_ids as one comma-joined value', () => {
    const url = buildUrl(crunchbaseGetOrganizationTool, {
      apiKey: 'k',
      entityId: '  tesla-motors  ',
      fieldIds: ['identifier', 'name'],
      cardIds: 'founders, headquarters_address',
    })
    expect(url).toContain('/v4/data/entities/organizations/tesla-motors?')
    expect(url).toContain('field_ids=identifier%2Cname')
    expect(url).toContain('card_ids=founders%2Cheadquarters_address')
  })

  it('omits field_ids on a generic lookup so the API picks its own projection', () => {
    const url = buildUrl(crunchbaseGetEntityTool, {
      apiKey: 'k',
      collection: 'events',
      entityId: 'techcrunch-disrupt',
    })
    expect(url).toBe('https://api.crunchbase.com/v4/data/entities/events/techcrunch-disrupt')
  })

  it('builds the single-card path with its own cursor params', () => {
    const url = buildUrl(crunchbaseGetEntityCardTool, {
      apiKey: 'k',
      collection: 'organizations',
      entityId: 'sequoia-capital',
      cardId: 'participated_investments',
      cardFieldIds: '["identifier","announced_on"]',
      cardOrder: 'funding_round_money_raised desc',
      afterId: 'cursor-1',
    })
    expect(url).toContain('/entities/organizations/sequoia-capital/cards/participated_investments?')
    expect(url).toContain('card_field_ids=identifier%2Cannounced_on')
    expect(url).toContain('order=funding_round_money_raised+desc')
    expect(url).toContain('after_id=cursor-1')
  })

  it('caps a card page at the documented 100-item maximum', () => {
    const url = buildUrl(crunchbaseGetEntityCardTool, {
      apiKey: 'k',
      collection: 'organizations',
      entityId: 'sequoia-capital',
      cardId: 'participated_investments',
      limit: 1000,
    })
    /* Substring-matching "limit=100" would also pass on "limit=1000" — the exact
       parameter value is the only assertion that can actually fail here. */
    expect(new URL(url).searchParams.get('limit')).toBe('100')
  })

  it('keeps the cursor field when cardFieldIds would have dropped it', () => {
    const narrowed = buildUrl(crunchbaseGetEntityCardTool, {
      apiKey: 'k',
      collection: 'organizations',
      entityId: 'sequoia-capital',
      cardId: 'participated_investments',
      cardFieldIds: '["announced_on"]',
    })
    expect(narrowed).toContain('card_field_ids=announced_on%2Cidentifier')

    const alreadyPresent = buildUrl(crunchbaseGetEntityCardTool, {
      apiKey: 'k',
      collection: 'organizations',
      entityId: 'sequoia-capital',
      cardId: 'participated_investments',
      cardFieldIds: '["uuid","announced_on"]',
    })
    /* Substring-matching the prefix would also pass on a list that appended
       "identifier" anyway — only the exact value proves it was left alone. */
    expect(new URL(alreadyPresent).searchParams.get('card_field_ids')).toBe('uuid,announced_on')
  })

  it('rejects both cursors on every paged endpoint, not just search', () => {
    expect(() =>
      buildUrl(crunchbaseGetEntityCardTool, {
        apiKey: 'k',
        collection: 'organizations',
        entityId: 'sequoia-capital',
        cardId: 'founders',
        afterId: 'a',
        beforeId: 'b',
      })
    ).toThrow(/either "afterId" or "beforeId"/)

    expect(() =>
      buildUrl(crunchbaseListDeletedEntitiesTool, { apiKey: 'k', afterId: 'a', beforeId: 'b' })
    ).toThrow(/either "afterId" or "beforeId"/)
  })

  it('scopes the deleted feed by path when one collection is chosen', () => {
    expect(
      buildUrl(crunchbaseListDeletedEntitiesTool, { apiKey: 'k', collection: 'organizations' })
    ).toBe('https://api.crunchbase.com/v4/data/deleted_entities/organizations')

    expect(
      buildUrl(crunchbaseListDeletedEntitiesTool, {
        apiKey: 'k',
        collectionIds: ['organizations', 'people'],
        deletedAtOrder: 'desc',
      })
    ).toBe(
      'https://api.crunchbase.com/v4/data/deleted_entities?collection_ids=organizations%2Cpeople&deleted_at_order=desc'
    )
  })

  it('rejects a collection no Crunchbase package publishes', () => {
    expect(() =>
      buildUrl(crunchbaseAutocompleteTool, {
        apiKey: 'k',
        query: 'airbnb',
        collectionIds: ['unicorns'],
      })
    ).toThrow(/unsupported collection/)
  })

  it('accepts a collection only a richer package publishes', () => {
    /* The allowlist is the union across packages, not the narrowest one — the
       Firmographic enum omits these, so a tier-narrow list would reject a
       request an Advanced Financials key answers. */
    expect(
      new URL(
        buildUrl(crunchbaseAutocompleteTool, {
          apiKey: 'k',
          query: 'sequoia',
          collectionIds: ['funds', 'funding_rounds', 'acquisitions'],
        })
      ).searchParams.get('collection_ids')
    ).toBe('funds,funding_rounds,acquisitions')

    expect(
      buildUrl(crunchbaseListDeletedEntitiesTool, { apiKey: 'k', collection: 'funding_rounds' })
    ).toBe('https://api.crunchbase.com/v4/data/deleted_entities/funding_rounds')
  })

  it('caps the deleted feed at its own documented maximum, not the search maximum', () => {
    /* `/data/deleted_entities` documents "default = 10, max = 25" while Search
       allows 1000, and the block shares one Limit subblock across both. */
    expect(
      new URL(
        buildUrl(crunchbaseListDeletedEntitiesTool, { apiKey: 'k', limit: 1000 })
      ).searchParams.get('limit')
    ).toBe('25')
  })

  it('reads fields metadata from the /md path, not /data', () => {
    expect(
      buildUrl(crunchbaseGetFieldsMetadataTool, { apiKey: 'k', collectionIds: ['organizations'] })
    ).toBe(
      'https://api.crunchbase.com/v4/md/applications/crunchbase/fields?collection_ids=organizations'
    )
  })
})

describe('crunchbase response mapping', () => {
  it('carries the last uuid forward as the next page cursor', async () => {
    const result = await crunchbaseSearchOrganizationsTool.transformResponse!(
      jsonResponse({
        count: 812,
        entities: [
          { uuid: 'a', properties: { name: 'Alpha' } },
          { uuid: 'b', properties: { name: 'Beta' } },
        ],
      })
    )

    expect(result.output.count).toBe(812)
    expect(result.output.entities).toHaveLength(2)
    expect(result.output.nextAfterId).toBe('b')
  })

  it('reports an empty page as empty rather than as a missing count', async () => {
    const result = await crunchbaseSearchOrganizationsTool.transformResponse!(
      jsonResponse({ count: 0, entities: [] })
    )
    expect(result.output.count).toBe(0)
    expect(result.output.entities).toEqual([])
    expect(result.output.nextAfterId).toBeNull()
  })

  it('lifts identity out of the dynamic property bag', async () => {
    const result = await crunchbaseGetOrganizationTool.transformResponse!(
      jsonResponse({
        properties: {
          identifier: {
            uuid: 'e1a1',
            value: 'Tesla',
            permalink: 'tesla-motors',
            entity_def_id: 'organization',
          },
        },
        cards: { founders: [{ uuid: 'p1' }] },
      })
    )

    expect(result.output.uuid).toBe('e1a1')
    expect(result.output.name).toBe('Tesla')
    expect(result.output.permalink).toBe('tesla-motors')
    expect(result.output.cards).toEqual({ founders: [{ uuid: 'p1' }] })
  })

  it('degrades identity to null when field_ids dropped the identifier', async () => {
    const result = await crunchbaseGetOrganizationTool.transformResponse!(
      jsonResponse({ properties: { short_description: 'Electric cars' } })
    )
    expect(result.output.uuid).toBeNull()
    expect(result.output.name).toBeNull()
    expect(result.output.permalink).toBeNull()
    expect(result.output.cards).toBeNull()
  })

  it('reads a card page from under its own card id', async () => {
    const params = {
      apiKey: 'k',
      collection: 'organizations',
      entityId: 'sequoia-capital',
      cardId: 'participated_investments',
    }
    const result = await crunchbaseGetEntityCardTool.transformResponse!(
      jsonResponse({
        properties: { identifier: { uuid: 'org-1' } },
        cards: {
          participated_investments: [
            { identifier: { uuid: 'i1' } },
            { identifier: { uuid: 'i2' } },
          ],
        },
      }),
      params as never
    )

    expect(result.output.items).toHaveLength(2)
    expect(result.output.nextAfterId).toBe('i2')
  })

  it('keys the card page by the trimmed id the URL used', async () => {
    const result = await crunchbaseGetEntityCardTool.transformResponse!(
      jsonResponse({ cards: { founders: [{ identifier: { uuid: 'p1' } }] } }),
      {
        apiKey: 'k',
        collection: 'organizations',
        entityId: 'tesla-motors',
        cardId: '  founders  ',
      } as never
    )

    expect(result.output.items).toHaveLength(1)
    expect(result.output.nextAfterId).toBe('p1')
  })

  it('reports an undocumented card shape as empty rather than inventing a row', async () => {
    const result = await crunchbaseGetEntityCardTool.transformResponse!(
      jsonResponse({ cards: { founders: { items: [{ uuid: 'p1' }], paging: {} } } }),
      {
        apiKey: 'k',
        collection: 'organizations',
        entityId: 'tesla-motors',
        cardId: 'founders',
      } as never
    )

    expect(result.output.items).toEqual([])
    expect(result.output.nextAfterId).toBeNull()
  })

  it('passes the fields-metadata CSV through verbatim', async () => {
    const csv = 'collection_id,field_id,type\norganizations,name,text\n'
    const result = await crunchbaseGetFieldsMetadataTool.transformResponse!(
      new Response(csv, { status: 200 })
    )
    expect(result.output.csv).toBe(csv)
  })
})

describe('crunchbase error reporting', () => {
  /*
   * The tool layer throws on a non-ok response before `transformResponse` runs,
   * so the message a user sees comes from the extractor — and Crunchbase answers
   * with a bare array, which nothing else in the registry reads.
   */
  it('reads the message out of the top-level error array', () => {
    expect(
      extractErrorMessage(
        { status: 401, data: [{ status: 401, code: 'LA401', message: 'Unauthorized user_key' }] },
        crunchbaseSearchOrganizationsTool.errorExtractor
      )
    ).toBe('Unauthorized user_key')
  })

  it('falls back to the status when the body carries no message', () => {
    expect(
      extractErrorMessage(
        { status: 500, data: [] },
        crunchbaseSearchOrganizationsTool.errorExtractor
      )
    ).toBe('Request failed with status 500')
  })
})
