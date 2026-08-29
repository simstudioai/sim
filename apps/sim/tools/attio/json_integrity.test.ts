/**
 * @vitest-environment node
 *
 * Guards every Attio tool against silent data substitution when a JSON-encoded
 * parameter fails to parse.
 *
 * Several tools caught the `JSON.parse` failure and substituted an empty value
 * (`{}` / `[]`) before reporting success. The worst case was
 * `attio_query_list_entries`: a filter the caller set was silently dropped, the
 * **unfiltered** query ran against the whole list, and the tool reported
 * success — so the caller received rows they never asked for and had no signal
 * that their filter was discarded.
 *
 * The established pattern in this folder (`create_record`, `assert_record`,
 * `update_record`, `create_attribute`, `update_attribute`, `list_records`) is
 * to throw a named `Invalid JSON provided for …` error. This file pins that
 * pattern for every tool, and the sweep below is written so that a NEW tool
 * that swallows a parse failure fails CI without anyone remembering to add it.
 */
import { describe, expect, it } from 'vitest'
import * as attioTools from '@/tools/attio/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const SENTINEL = '__ATTIO_SENTINEL__'
const VALID_JSON_WITH_SENTINEL = `["${SENTINEL}"]`
const MALFORMED_JSON_WITH_SENTINEL = `["${SENTINEL}"`

/** A valid JSON object that is also a harmless plain-string value. */
const NEUTRAL_FILLER = '{}'

function isAttioTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('attio_')
  )
}

const BODY_TOOLS = Object.values(attioTools)
  .filter(isAttioTool)
  .filter((tool) => typeof tool.request?.body === 'function')

function stringParamNames(tool: AnyTool): string[] {
  return Object.entries(tool.params ?? {})
    .filter(([name]) => name !== 'accessToken')
    .filter(([, def]) => {
      const type = (def as { type?: string }).type
      return type === undefined || type === 'string' || type === 'json'
    })
    .map(([name]) => name)
}

function buildParams(tool: AnyTool, overrideName: string, overrideValue: string) {
  const params: Record<string, unknown> = { accessToken: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'accessToken') continue
    const type = (def as { type?: string }).type
    if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = NEUTRAL_FILLER
    }
  }
  params[overrideName] = overrideValue
  return params
}

function serializeBody(tool: AnyTool, overrideName: string, overrideValue: string): string {
  const body = tool.request?.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no body builder`)
  return JSON.stringify(body(buildParams(tool, overrideName, overrideValue) as any))
}

/**
 * Params that actually reach the request body, discovered by feeding a valid
 * JSON value carrying a sentinel and checking whether the sentinel survives.
 * Params that only feed the URL are skipped rather than hard-coded.
 */
const BODY_PARAM_CASES = BODY_TOOLS.flatMap((tool) =>
  stringParamNames(tool)
    .filter((name) => {
      try {
        return serializeBody(tool, name, VALID_JSON_WITH_SENTINEL).includes(SENTINEL)
      } catch {
        return false
      }
    })
    .map((param) => ({ name: `${tool.id} / ${param}`, tool, param }))
)

describe('attio JSON parse integrity', () => {
  it('discovers the body-bound params it is meant to cover', () => {
    expect(BODY_PARAM_CASES.length).toBeGreaterThanOrEqual(20)
  })

  it.each(BODY_PARAM_CASES)(
    '$name never silently drops a value that fails to parse',
    ({ tool, param }) => {
      let serialized: string
      try {
        serialized = serializeBody(tool, param, MALFORMED_JSON_WITH_SENTINEL)
      } catch {
        return
      }

      expect(serialized).toContain(SENTINEL)
    }
  )
})

/**
 * The parse sites confirmed on staging as swallowing the failure. Each must now
 * throw the folder's named error rather than substituting an empty value.
 */
const SWALLOWED_SITES: ReadonlyArray<{ id: string; param: string }> = [
  { id: 'attio_create_list_entry', param: 'entryValues' },
  { id: 'attio_update_list_entry', param: 'entryValues' },
  { id: 'attio_create_task', param: 'linkedRecords' },
  { id: 'attio_create_task', param: 'assignees' },
  { id: 'attio_update_task', param: 'linkedRecords' },
  { id: 'attio_update_task', param: 'assignees' },
  { id: 'attio_create_webhook', param: 'subscriptions' },
  { id: 'attio_update_webhook', param: 'subscriptions' },
  { id: 'attio_create_list', param: 'workspaceMemberAccess' },
  { id: 'attio_update_list', param: 'workspaceMemberAccess' },
  { id: 'attio_query_list_entries', param: 'filter' },
  { id: 'attio_query_list_entries', param: 'sorts' },
]

function toolById(id: string): AnyTool {
  const tool = BODY_TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`${id} is not an Attio tool with a body builder`)
  return tool
}

describe.each(SWALLOWED_SITES)('$id / $param', ({ id, param }) => {
  it('throws a named Invalid JSON error instead of substituting an empty value', () => {
    expect(() => serializeBody(toolById(id), param, '{"broken":')).toThrow(/Invalid JSON provided/)
  })

  it('still accepts a well-formed value', () => {
    expect(() => serializeBody(toolById(id), param, VALID_JSON_WITH_SENTINEL)).not.toThrow()
  })
})

/**
 * `attio_query_list_entries` is called out on its own because its failure mode
 * is the most damaging: dropping the filter widens the query rather than
 * narrowing it, so the caller gets MORE data than they asked for.
 */
describe('attio_query_list_entries filter integrity', () => {
  const tool = toolById('attio_query_list_entries')

  it('never runs an unfiltered query when the filter fails to parse', () => {
    expect(() => serializeBody(tool, 'filter', '{"name":{"$eq":"acme"')).toThrow(
      /Invalid JSON provided for filter/
    )
  })

  it('forwards a well-formed filter verbatim', () => {
    const serialized = serializeBody(tool, 'filter', '{"name":{"$eq":"acme"}}')

    expect(JSON.parse(serialized).filter).toEqual({ name: { $eq: 'acme' } })
  })
})
