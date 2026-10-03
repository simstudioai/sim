/**
 * Guards the invariants of the shared `utils.ts` refactor: the eight
 * pre-existing generic Table API tools must keep their original wire behavior,
 * and the semantic tools must default `sysparm_display_value` to `all` without
 * leaking that default onto the generic ones.
 */
import { describe, expect, it } from 'vitest'
import { ServiceNowBlock } from '@/blocks/blocks/servicenow'
import * as servicenowTools from '@/tools/servicenow'
import { aggregateTool } from '@/tools/servicenow/aggregate'
import { DEFAULT_DISPLAY_VALUE } from '@/tools/servicenow/constants'
import { createIncidentTool } from '@/tools/servicenow/create_incident'
import { createRecordTool } from '@/tools/servicenow/create_record'
import { deleteRecordTool } from '@/tools/servicenow/delete_record'
import { getChangeNextStatesTool } from '@/tools/servicenow/get_change_next_states'
import { getIncidentTool } from '@/tools/servicenow/get_incident'
import { listIncidentsTool } from '@/tools/servicenow/list_incidents'
import { readRecordTool } from '@/tools/servicenow/read_record'
import { searchKnowledgeTool } from '@/tools/servicenow/search_knowledge'
import { updateChangeStateTool } from '@/tools/servicenow/update_change_state'
import { updateRecordTool } from '@/tools/servicenow/update_record'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const auth = {
  instanceUrl: 'https://example.service-now.com',
  username: 'svc.user',
  password: PLACEHOLDER_PASSWORD,
}

function urlOf(tool: { request: { url: (p: never) => string } }, params: unknown): URL {
  return new URL(tool.request.url(params as never))
}

function headersOf(
  tool: { request: { headers?: (p: never) => Record<string, string> } },
  params: unknown
) {
  return tool.request.headers?.(params as never) ?? {}
}

describe('ServiceNow shared request helpers', () => {
  it('normalizes the instance URL by trimming whitespace and a trailing slash', () => {
    const url = urlOf(readRecordTool, {
      ...auth,
      instanceUrl: '  https://example.service-now.com/  ',
      tableName: 'incident',
    })
    expect(url.origin).toBe('https://example.service-now.com')
    expect(url.pathname).toBe('/api/now/table/incident')
  })

  it('throws the original message when the instance URL is blank', () => {
    expect(() =>
      urlOf(readRecordTool, { ...auth, instanceUrl: '   ', tableName: 'incident' })
    ).toThrow('ServiceNow instance URL is required')
  })

  it('throws the original message when credentials are missing', () => {
    expect(() =>
      headersOf(readRecordTool, { ...auth, password: '', tableName: 'incident' })
    ).toThrow('ServiceNow username and password are required')
  })
})

describe('sysparm_display_value separation', () => {
  it('read_record omits sysparm_display_value unless the caller sets one', () => {
    const url = urlOf(readRecordTool, { ...auth, tableName: 'incident' })
    expect(url.searchParams.has('sysparm_display_value')).toBe(false)
  })

  it('read_record still forwards an explicit display value', () => {
    const url = urlOf(readRecordTool, { ...auth, tableName: 'incident', displayValue: 'true' })
    expect(url.searchParams.get('sysparm_display_value')).toBe('true')
  })

  it('aggregate omits sysparm_display_value unless the caller sets one', () => {
    const url = urlOf(aggregateTool, { ...auth, tableName: 'incident', count: true })
    expect(url.searchParams.has('sysparm_display_value')).toBe(false)
  })

  it('semantic reads default to all', () => {
    expect(urlOf(listIncidentsTool, auth).searchParams.get('sysparm_display_value')).toBe(
      DEFAULT_DISPLAY_VALUE
    )
    expect(
      urlOf(getIncidentTool, { ...auth, number: 'INC0010001' }).searchParams.get(
        'sysparm_display_value'
      )
    ).toBe(DEFAULT_DISPLAY_VALUE)
  })

  it('semantic writes default to all and omit sysparm_input_display_value', () => {
    const url = urlOf(createIncidentTool, { ...auth, shortDescription: 'x' })
    expect(url.searchParams.get('sysparm_display_value')).toBe(DEFAULT_DISPLAY_VALUE)
    expect(url.searchParams.has('sysparm_input_display_value')).toBe(false)
  })

  it('semantic writes surface sysparm_input_display_value when enabled', () => {
    const url = urlOf(createIncidentTool, {
      ...auth,
      shortDescription: 'x',
      inputDisplayValue: true,
    })
    expect(url.searchParams.get('sysparm_input_display_value')).toBe('true')
  })
})

describe('block params mapping keeps per-operation defaults from colliding', () => {
  const mapParams = ServiceNowBlock.tools.config?.params

  /**
   * Every subBlock default is seeded by id, so two subBlocks sharing an id
   * would leave a single stored value that the last definition wins.
   */
  function seededDefaults(): Record<string, unknown> {
    const seeded: Record<string, unknown> = {}
    for (const subBlock of ServiceNowBlock.subBlocks) {
      if (typeof subBlock.value === 'function') {
        seeded[subBlock.id] = (subBlock.value as (p: Record<string, never>) => unknown)({})
      }
    }
    return seeded
  }

  /**
   * The block's mapping is merged over the raw inputs as
   * `{ ...inputs, ...mapped }`, so a key the mapper leaves off is not dropped —
   * it keeps whatever the subBlock store held. Assertions therefore have to be
   * made against the merged result, not the mapper's return value.
   */
  function mergedParams(stored: Record<string, unknown>): Record<string, unknown> {
    const inputs = { ...seededDefaults(), ...auth, ...stored }
    const mapped = (mapParams?.(inputs as never) ?? {}) as Record<string, unknown>
    return { ...inputs, ...mapped }
  }

  /**
   * Standing guard for the whole bug class: a subBlock id may legitimately be
   * reused across operations that feed the same tool param, but the definitions
   * must agree on the seeded value, since only the last one survives. An absent
   * default and an empty default both mean "unset" and are treated as equal.
   */
  it('never lets one subBlock id carry two different seeded defaults', () => {
    const seededById = new Map<string, Set<string>>()
    for (const subBlock of ServiceNowBlock.subBlocks) {
      const seeded =
        typeof subBlock.value === 'function'
          ? (subBlock.value as (p: Record<string, never>) => unknown)({})
          : undefined
      const normalized = seeded === undefined || seeded === '' ? '' : JSON.stringify(seeded)
      const values = seededById.get(subBlock.id) ?? new Set<string>()
      values.add(normalized)
      seededById.set(subBlock.id, values)
    }

    const conflicts = [...seededById.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([id, values]) => `${id}: ${[...values].join(' vs ')}`)

    expect(conflicts).toEqual([])
  })

  it('does not leak the semantic "all" default onto the generic Table API tools', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_read_record',
      tableName: 'incident',
    } as never) as Record<string, unknown>

    expect(mapped.displayValue).toBeFalsy()
  })

  it('does not leak the semantic "all" default onto aggregate', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_aggregate',
      tableName: 'incident',
    } as never) as Record<string, unknown>

    expect(mapped.displayValue).toBeFalsy()
  })

  it('applies the semantic "all" default on a semantic operation', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_list_incidents',
    } as never) as Record<string, unknown>

    expect(mapped.displayValue).toBe(DEFAULT_DISPLAY_VALUE)
  })

  it('does not leak the approval state default onto incident creation', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_create_incident',
      shortDescription: 'x',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBeFalsy()
  })

  it('routes the approval state control to state for list approvals', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_list_approvals',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBe('requested')
  })

  it('routes the target state control to state for a change transition', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_update_change_state',
      sysId: 'chg1',
      targetState: '3',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBe('3')
  })

  /**
   * Both controls are `required: true` and visible, so a seeded value is a
   * consequential answer the caller never gave: Move Change State would PATCH
   * the change backwards to New, and Approve or Reject would approve.
   */
  it.each([
    ['targetState', 'servicenow_update_change_state'],
    ['decision', 'servicenow_update_approval'],
  ])('leaves the required %s control unseeded', (subBlockId) => {
    const subBlock = ServiceNowBlock.subBlocks.find((candidate) => candidate.id === subBlockId)

    expect(subBlock?.required).toBe(true)
    expect(subBlock?.value).toBeUndefined()
  })

  it('sends no state for a change transition until one is chosen', () => {
    const mapped = mapParams?.({
      ...seededDefaults(),
      ...auth,
      operation: 'servicenow_update_change_state',
      sysId: 'chg1',
    } as never) as Record<string, unknown>

    expect(mapped.state).toBeFalsy()
  })

  it('sends no approval decision until one is chosen', () => {
    const merged = mergedParams({
      operation: 'servicenow_update_approval',
      approvalSysId: 'apr1',
    })

    expect(merged.decision).toBeFalsy()
  })
})

describe('one subBlock id never carries two different value spaces', () => {
  const mapParams = ServiceNowBlock.tools.config?.params

  function seededDefaults(): Record<string, unknown> {
    const seeded: Record<string, unknown> = {}
    for (const subBlock of ServiceNowBlock.subBlocks) {
      if (typeof subBlock.value === 'function') {
        seeded[subBlock.id] = (subBlock.value as (p: Record<string, never>) => unknown)({})
      }
    }
    return seeded
  }

  function mergedParams(stored: Record<string, unknown>): Record<string, unknown> {
    const inputs = { ...seededDefaults(), ...auth, ...stored }
    const mapped = (mapParams?.(inputs as never) ?? {}) as Record<string, unknown>
    return { ...inputs, ...mapped }
  }

  /**
   * Subblock values are stored per block keyed by id, so switching operations
   * leaves the previous operation's value in place. Where two operations mean
   * different things by the same tool param — an incident state versus a change
   * state, a close code from two different choice lists, a search phrase versus
   * an encoded query — they must not share a subBlock id, or the stale value
   * rides along and is written to the wrong record.
   */
  it.each([
    ['incidentState', 'changeState', 'state', 'servicenow_update_change_request', '6', '-2'],
    ['changeState', 'incidentState', 'state', 'servicenow_update_incident', '-2', '6'],
    [
      'resolutionCode',
      'changeCloseCode',
      'closeCode',
      'servicenow_update_change_request',
      'Solved (Permanently)',
      'successful',
    ],
    [
      'incidentComments',
      'approvalComments',
      'comments',
      'servicenow_update_approval',
      'visible to the caller',
      'approved by change board',
    ],
    [
      'query',
      'knowledgeQuery',
      'query',
      'servicenow_search_knowledge',
      'active=true^priority=1',
      'vpn setup',
    ],
    /**
     * Both directions, since neither limit branch used to be scoped to an
     * operation and whichever ran last won. The values are numeric so `Number()`
     * is the identity — the assertion is purely about which subBlock is read.
     */
    ['attachmentLimit', 'limit', 'limit', 'servicenow_list_incidents', 5, 100],
    ['limit', 'attachmentLimit', 'limit', 'servicenow_list_attachments', 7, 25],
  ])(
    'a stale %s never reaches %s of the wrong operation',
    (staleId, ownId, param, operation, staleValue, ownValue) => {
      const leaked = mergedParams({ operation, [staleId]: staleValue })
      expect(leaked[param]).not.toBe(staleValue)

      const kept = mergedParams({ operation, [staleId]: staleValue, [ownId]: ownValue })
      expect(kept[param]).toBe(ownValue)
    }
  )

  /**
   * The `fields` tool param carries a JSON body on Create/Update Record and a
   * comma-separated projection everywhere else, so no subBlock id may serve
   * both. These assertions store the value under the id the *projection*
   * control really writes to, which is the whole point: sharing `fields`
   * between Read Records and the two JSON bodies left one stored value
   * straddling both value spaces.
   */
  const readProjectionId = ServiceNowBlock.subBlocks.find(
    (subBlock) =>
      subBlock.title === 'Fields to Return' &&
      subBlock.condition &&
      'value' in subBlock.condition &&
      subBlock.condition.value === 'servicenow_read_record'
  )?.id

  it('gives Read Records a projection control of its own', () => {
    expect(readProjectionId).toBeDefined()
  })

  it('never sends a JSON body as a field projection', () => {
    const merged = mergedParams({
      operation: 'servicenow_list_incidents',
      fields: '{"short_description":"x"}',
      returnFields: 'number,short_description',
    })
    expect(merged.fields).toBe('number,short_description')
  })

  it('never sends a stale create body as the Read Records projection', () => {
    const merged = mergedParams({
      operation: 'servicenow_read_record',
      tableName: 'incident',
      fields: '{"short_description":"x"}',
    })

    expect(merged.fields).toBeUndefined()
  })

  it('never parses a field projection as a create body', () => {
    expect(() =>
      mergedParams({
        operation: 'servicenow_create_record',
        tableName: 'incident',
        [readProjectionId as string]: 'number,short_description',
      })
    ).not.toThrow()
  })

  it('never lets one subBlock id carry both a JSON body and a plain projection', () => {
    const typesById = new Map<string, Set<string>>()
    for (const subBlock of ServiceNowBlock.subBlocks) {
      const types = typesById.get(subBlock.id) ?? new Set<string>()
      types.add(subBlock.type)
      typesById.set(subBlock.id, types)
    }

    const straddling = [...typesById.entries()]
      .filter(([, types]) => types.has('code') && types.has('short-input'))
      .map(([id]) => id)

    expect(straddling).toEqual([])
  })

  /**
   * `tools.config.params` runs unguarded, so a bare `JSON.parse` escaped as
   * `JSON Parse error: Expected '}'` with nothing naming the control to fix.
   */
  it.each([
    ['additionalFields', 'servicenow_update_incident', 'Additional Fields must be a JSON object'],
    ['variables', 'servicenow_order_catalog_item', 'Item Variables must be a JSON object'],
    ['fields', 'servicenow_create_record', 'Fields must be a JSON object'],
  ])('names the %s control when its JSON is malformed', (subBlockId, operation, message) => {
    expect(() =>
      mergedParams({ operation, tableName: 'incident', sysId: 'x', [subBlockId]: '{"a": }' })
    ).toThrow(message)
  })

  /**
   * `update_approval` spreads the same `writeParams` as the other semantic
   * writes but addresses its record by `approvalSysId`, so it sat outside
   * `SEMANTIC_WRITE_OPS` and was the one operation where a stale advanced
   * `displayValue`/`returnFields` reached the wire with no control surfacing it.
   */
  it('surfaces the semantic display-value default on update_approval', () => {
    const merged = mergedParams({
      operation: 'servicenow_update_approval',
      approvalSysId: 'apr1',
      decision: 'approved',
    })

    expect(merged.displayValue).toBe(DEFAULT_DISPLAY_VALUE)
  })

  it.each(['semanticDisplayValue', 'returnFields', 'inputDisplayValue'])(
    'offers the %s control on update_approval',
    (subBlockId) => {
      const subBlock = ServiceNowBlock.subBlocks.find((candidate) => candidate.id === subBlockId)
      const conditionValue =
        subBlock?.condition && 'value' in subBlock.condition ? subBlock.condition.value : undefined
      const ops = Array.isArray(conditionValue) ? conditionValue : [conditionValue]

      expect(ops).toContain('servicenow_update_approval')
    }
  )

  it('leaves the generic Table API operations without a semantic state', () => {
    const merged = mergedParams({
      operation: 'servicenow_read_record',
      tableName: 'incident',
      incidentState: '6',
    })
    expect(merged.state).toBeUndefined()
  })
})

describe('every subBlock a tool reads is one the tool actually declares', () => {
  const toolsById = new Map(Object.values(servicenowTools).map((tool) => [tool.id, tool] as const))

  /**
   * The block seeds and serializes a subBlock purely from its `condition`, with
   * no check that the target tool declares a matching param. A control offered
   * on an operation whose tool ignores it is a silent data-loss bug: the user
   * fills it in, the block maps it, and the request builder drops it.
   */
  it.each([
    ['additionalFields', 'additionalFields'],
    ['targetState', 'state'],
    ['approvalState', 'state'],
  ])('routes the %s control only to operations declaring %s', (subBlockId, paramName) => {
    const subBlock = ServiceNowBlock.subBlocks.find((candidate) => candidate.id === subBlockId)
    const conditionValue =
      subBlock?.condition && 'value' in subBlock.condition ? subBlock.condition.value : undefined
    const ops = Array.isArray(conditionValue) ? conditionValue : [conditionValue]

    const ignoring = ops
      .filter((op): op is string => typeof op === 'string')
      .filter((op) => !toolsById.get(op)?.params?.[paramName])

    expect(ignoring).toEqual([])
  })

  it('lets a change transition carry raw fields the named controls do not cover', () => {
    const body = updateChangeStateTool.request.body?.({
      ...auth,
      sysId: 'chg1',
      state: '-2',
      additionalFields: { on_hold_reason: 'Awaiting vendor' },
    } as never)

    expect(body).toEqual({ state: '-2', on_hold_reason: 'Awaiting vendor' })
  })
})

describe('a successful response never yields a non-record where a record is declared', () => {
  /**
   * A collection member that is not a plain object would otherwise be cast and
   * handed to the next block as a record, so the tool reports success while
   * emitting a value its declared output says cannot occur.
   */
  it('drops non-object members of a record collection', async () => {
    const output = (await listIncidentsTool.transformResponse?.(
      new Response(JSON.stringify({ result: [{ number: 'INC1' }, null, 'oops', [1], 7] }), {
        status: 200,
      }) as never,
      undefined as never
    )) as { output: { records: unknown[]; metadata: { recordCount: number } } }

    expect(output.output.records).toEqual([{ number: 'INC1' }])
    expect(output.output.metadata.recordCount).toBe(1)
  })

  it('reports no record when a single-record endpoint returns a scalar', async () => {
    const output = (await getIncidentTool.transformResponse?.(
      new Response(JSON.stringify({ result: 'not a record' }), { status: 200 }) as never,
      undefined as never
    )) as { output: { record: unknown; metadata: { recordCount: number } } }

    expect(output.output.record).toBeNull()
    expect(output.output.metadata.recordCount).toBe(0)
  })

  it('drops non-object knowledge articles', async () => {
    const output = (await searchKnowledgeTool.transformResponse?.(
      new Response(
        JSON.stringify({ result: { articles: [{ id: 'kb_knowledge:1' }, null, 'x'], meta: {} } }),
        { status: 200 }
      ) as never,
      undefined as never
    )) as { output: { articles: unknown[] } }

    expect(output.output.articles).toEqual([{ id: 'kb_knowledge:1' }])
  })

  it('drops non-object change state transitions', async () => {
    const output = (await getChangeNextStatesTool.transformResponse?.(
      new Response(
        JSON.stringify({
          result: {
            available_states: ['0'],
            state_transitions: [[{ to_state: '0', transition_available: true }, null], ['nope']],
            state_label: { '0': 'Review' },
          },
        }),
        { status: 200 }
      ) as never,
      undefined as never
    )) as { output: { stateTransitions: unknown[]; allowedStates: string[] } }

    expect(output.output.stateTransitions).toEqual([{ to_state: '0', transition_available: true }])
    expect(output.output.allowedStates).toEqual(['0'])
  })
})

describe('get_change_next_states', () => {
  /** The sample response published with the nextstates endpoint. */
  const documentedResult = {
    result: {
      available_states: ['0', '4', '-1'],
      state_transitions: [
        [
          {
            sys_id: '7a0d2ccdc343101035ae3f52c1d3ae2e',
            display_value: 'Implement to Review',
            from_state: '-1',
            to_state: '0',
            transition_available: false,
            automatic_transition: true,
            conditions: [
              {
                passed: false,
                condition: {
                  name: 'No active Change Tasks',
                  description: null,
                  sys_id: '3c1d2ccdc343101035ae3f52c1d3aea4',
                },
              },
            ],
          },
          {
            sys_id: 'db401481c343101035ae3f52c1d3aedd',
            display_value: 'Implement to Review',
            from_state: '-1',
            to_state: '0',
            transition_available: true,
            automatic_transition: false,
            conditions: [
              {
                passed: true,
                condition: {
                  name: 'Not On hold',
                  description: null,
                  sys_id: '2132deb6c303101035ae3f52c1d3ae8c',
                },
              },
            ],
          },
        ],
        [
          {
            sys_id: '5327c551c343101035ae3f52c1d3aeec',
            display_value: 'Implement to Canceled',
            from_state: '-1',
            to_state: '4',
            transition_available: true,
            automatic_transition: false,
            conditions: [],
          },
        ],
      ],
      state_label: { '0': 'Review', '4': 'Canceled', '-1': 'Implement' },
    },
  }

  it('targets the documented nextstates endpoint', () => {
    const url = urlOf(getChangeNextStatesTool, { ...auth, changeSysId: ' chg1 ' })
    expect(url.pathname).toBe('/api/sn_chg_rest/change/chg1/nextstates')
  })

  it('flattens the per-target-state grouping and derives the reachable states', async () => {
    const output = (await getChangeNextStatesTool.transformResponse?.(
      new Response(JSON.stringify(documentedResult), { status: 200 }) as never,
      undefined as never
    )) as { output: Record<string, unknown> }

    expect(output.output.availableStates).toEqual(['0', '4', '-1'])
    expect(output.output.stateTransitions).toHaveLength(3)
    expect(output.output.stateLabels).toEqual({ '0': 'Review', '4': 'Canceled', '-1': 'Implement' })
    expect(output.output.metadata).toEqual({ transitionCount: 3 })
  })

  it('reports only states whose transition is currently available, without duplicates', async () => {
    const output = (await getChangeNextStatesTool.transformResponse?.(
      new Response(JSON.stringify(documentedResult), { status: 200 }) as never,
      undefined as never
    )) as { output: { allowedStates: string[] } }

    expect(output.output.allowedStates).toEqual(['0', '4'])
  })

  it('surfaces the instance error message', async () => {
    await expect(
      getChangeNextStatesTool.transformResponse?.(
        new Response(JSON.stringify({ error: { message: 'No Record found' } }), {
          status: 404,
        }) as never,
        undefined as never
      )
    ).rejects.toThrow('No Record found')
  })
})

describe('the legacy generic tools are hardened like the semantic ones', () => {
  it('read_record reports no records when the envelope carries no result', async () => {
    const output = (await readRecordTool.transformResponse?.(
      new Response(JSON.stringify({}), { status: 200 }) as never,
      undefined as never
    )) as { output: { records: unknown[]; metadata: { recordCount: number } } }

    expect(output.output.records).toEqual([])
    expect(output.output.metadata.recordCount).toBe(0)
  })

  it('read_record drops non-object collection members', async () => {
    const output = (await readRecordTool.transformResponse?.(
      new Response(JSON.stringify({ result: [{ sys_id: '1' }, null, 'x'] }), {
        status: 200,
      }) as never,
      undefined as never
    )) as { output: { records: unknown[]; metadata: { recordCount: number } } }

    expect(output.output.records).toEqual([{ sys_id: '1' }])
    expect(output.output.metadata.recordCount).toBe(1)
  })

  it.each([
    ['create_record', createRecordTool],
    ['update_record', updateRecordTool],
  ])('%s never emits undefined where a record is declared', async (_name, tool) => {
    const output = (await tool.transformResponse?.(
      new Response(JSON.stringify({}), { status: 200 }) as never,
      undefined as never
    )) as { output: { record: unknown } }

    expect(output.output.record).toEqual({})
    expect(output.output.record).toBeDefined()
  })

  it('delete_record surfaces the instance message rather than a JSON dump', async () => {
    await expect(
      deleteRecordTool.transformResponse?.(
        new Response(JSON.stringify({ error: { message: 'No Record found' } }), {
          status: 404,
        }) as never,
        undefined as never
      )
    ).rejects.toThrowError(new Error('No Record found'))
  })

  /**
   * A proxy in front of the instance answers with an HTML error page, which is
   * the text a caller needs. Dumping a synthesized `{"status":...}` object
   * instead hides the only diagnostic there was. Exact equality, since a
   * substring match would also pass against a dump that merely contains the
   * status.
   */
  it('delete_record surfaces a gateway body verbatim instead of a synthesized dump', async () => {
    await expect(
      deleteRecordTool.transformResponse?.(
        new Response('<html><body>503 Service Unavailable</body></html>', {
          status: 503,
          statusText: 'Service Unavailable',
        }) as never,
        undefined as never
      )
    ).rejects.toThrowError(new Error('<html><body>503 Service Unavailable</body></html>'))
  })

  it('delete_record reports the status when a gateway answers with no body at all', async () => {
    await expect(
      deleteRecordTool.transformResponse?.(
        new Response(null, { status: 502, statusText: 'Bad Gateway' }) as never,
        undefined as never
      )
    ).rejects.toThrowError(new Error('ServiceNow request failed (502 Bad Gateway)'))
  })

  /**
   * The Aggregate API reports `stats.count` as a *string*, so a reader that
   * accepts only a number drops every count it actually returns.
   */
  it('aggregate reads the string count the API really sends', async () => {
    const output = (await aggregateTool.transformResponse?.(
      new Response(JSON.stringify({ result: { stats: { count: '42' } } }), {
        status: 200,
      }) as never,
      undefined as never
    )) as { output: { count: number | null; metadata: { grouped: boolean } } }

    expect(output.output.count).toBe(42)
    expect(output.output.metadata.grouped).toBe(false)
  })

  it('aggregate reports no count rather than NaN when stats are absent', async () => {
    const output = (await aggregateTool.transformResponse?.(
      new Response(JSON.stringify({ result: { stats: {} } }), { status: 200 }) as never,
      undefined as never
    )) as { output: { count: number | null } }

    expect(output.output.count).toBeNull()
  })

  it('aggregate drops non-object groups and counts the survivors', async () => {
    const output = (await aggregateTool.transformResponse?.(
      new Response(JSON.stringify({ result: [{ stats: { count: '1' } }, null, 'x'] }), {
        status: 200,
      }) as never,
      undefined as never
    )) as { output: { result: unknown; metadata: { grouped: boolean; groupCount: number | null } } }

    expect(output.output.result).toEqual([{ stats: { count: '1' } }])
    expect(output.output.metadata).toEqual({ grouped: true, groupCount: 1 })
  })

  it.each([
    ['read_record', readRecordTool],
    ['create_record', createRecordTool],
    ['update_record', updateRecordTool],
    ['aggregate', aggregateTool],
  ])('%s surfaces the instance error message on failure', async (_name, tool) => {
    await expect(
      tool.transformResponse?.(
        new Response(JSON.stringify({ error: { message: 'Insufficient rights' } }), {
          status: 403,
        }) as never,
        undefined as never
      )
    ).rejects.toThrowError(new Error('Insufficient rights'))
  })
})

describe('a cleared numeric field never reaches the instance as a blank param', () => {
  const mapParams = ServiceNowBlock.tools.config?.params

  /**
   * A short-input stores `''` once a user types a value and clears it again —
   * an untouched field stores `null` instead. The mapper's result is merged
   * over the raw inputs, so a blank left in place survives the merge and is
   * appended as a valueless `sysparm_limit=`.
   */
  function mergedParams(stored: Record<string, unknown>): Record<string, unknown> {
    const inputs = { ...auth, ...stored }
    const mapped = (mapParams?.(inputs as never) ?? {}) as Record<string, unknown>
    return { ...inputs, ...mapped }
  }

  it.each(['limit', 'offset', 'quantity'])(
    'resolves a cleared %s to undefined rather than leaving the blank in place',
    (param) => {
      const merged = mergedParams({
        operation: 'servicenow_read_record',
        tableName: 'incident',
        [param]: '',
      })

      expect(merged[param]).toBeUndefined()
    }
  )

  it('keeps a real numeric value through the mapper', () => {
    const merged = mergedParams({
      operation: 'servicenow_read_record',
      tableName: 'incident',
      limit: '25',
      offset: '10',
    })

    expect(merged.limit).toBe(25)
    expect(merged.offset).toBe(10)
  })

  it('omits sysparm_limit and sysparm_offset when the tools receive a blank', () => {
    const url = urlOf(listIncidentsTool, { ...auth, limit: '', offset: '' })

    expect(url.searchParams.has('sysparm_limit')).toBe(false)
    expect(url.searchParams.has('sysparm_offset')).toBe(false)
  })

  it('omits sysparm_offset on read_record when the offset is blank', () => {
    const url = urlOf(readRecordTool, { ...auth, tableName: 'incident', offset: '' })

    expect(url.searchParams.has('sysparm_offset')).toBe(false)
  })
})

describe('the limit guidance matches what the block actually sends', () => {
  function seededDefaults(): Record<string, unknown> {
    const seeded: Record<string, unknown> = {}
    for (const subBlock of ServiceNowBlock.subBlocks) {
      if (typeof subBlock.value === 'function') {
        seeded[subBlock.id] = (subBlock.value as (p: Record<string, never>) => unknown)({})
      }
    }
    return seeded
  }

  /**
   * Ground truth the guidance below has to agree with: neither the block nor the
   * tool supplies a limit, so an untouched List Incidents reaches the instance
   * with no `sysparm_limit` and inherits the Table API default of 10,000 rows.
   */
  it('sends no sysparm_limit for an untouched List Incidents block', () => {
    const inputs = { ...seededDefaults(), ...auth, operation: 'servicenow_list_incidents' }
    const mapped = (ServiceNowBlock.tools.config?.params?.(inputs as never) ?? {}) as Record<
      string,
      unknown
    >
    const url = urlOf(listIncidentsTool, { ...inputs, ...mapped })

    expect(url.searchParams.has('sysparm_limit')).toBe(false)
  })
})
