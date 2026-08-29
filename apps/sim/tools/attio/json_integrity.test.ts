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
import type { ToolConfig, ToolResponse } from '@/tools/types'

type BodyTool = ToolConfig<Record<string, unknown>, ToolResponse>

const SENTINEL = '__ATTIO_SENTINEL__'
const VALID_JSON_WITH_SENTINEL = `["${SENTINEL}"]`
const MALFORMED_JSON_WITH_SENTINEL = `["${SENTINEL}"`

/** A valid JSON object that is also a harmless plain-string value. */
const NEUTRAL_FILLER = '{}'

function isAttioTool(value: unknown): value is BodyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BodyTool).id === 'string' &&
    (value as BodyTool).id.startsWith('attio_')
  )
}

/**
 * Seeded as `unknown[]` so `isAttioTool` is the single narrowing point. The
 * barrel's element type is a union of `ToolConfig<AttioXParams, …>`, and
 * `ToolConfig` places its param type in the contravariant position of
 * `request.body`, so no specific member is assignable to `BodyTool` directly.
 */
const ALL_ATTIO_TOOLS: readonly unknown[] = Object.values(attioTools)

const BODY_TOOLS = ALL_ATTIO_TOOLS.filter(isAttioTool).filter(
  (tool) => typeof tool.request?.body === 'function'
)

function stringParamNames(tool: BodyTool): string[] {
  return Object.entries(tool.params ?? {})
    .filter(([name]) => name !== 'accessToken')
    .filter(([, def]) => {
      const type = (def as { type?: string }).type
      return type === undefined || type === 'string' || type === 'json'
    })
    .map(([name]) => name)
}

function buildParams(tool: BodyTool, overrideName: string, overrideValue: string) {
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

function serializeBody(tool: BodyTool, overrideName: string, overrideValue: string): string {
  const body = tool.request?.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no body builder`)
  return JSON.stringify(body(buildParams(tool, overrideName, overrideValue)))
}

/**
 * Where a param's value ended up in the serialized body.
 *
 * - `parsed`   — the sentinel appears as its own string inside an array or
 *   object, so the tool ran `JSON.parse` on the value.
 * - `raw`      — the sentinel appears only inside a longer string, so the tool
 *   forwarded the value verbatim. Correct for a plain-text param.
 * - `absent`   — the value never reaches the body (it feeds the URL instead).
 *
 * `parsed` wins if both are seen, so a tool that both parses and echoes a value
 * is still held to the parsing contract.
 */
type SentinelPlacement = 'parsed' | 'raw' | 'absent'

function classify(body: unknown): SentinelPlacement {
  let found: SentinelPlacement = 'absent'

  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value === SENTINEL) {
        found = 'parsed'
      } else if (value.includes(SENTINEL) && found === 'absent') {
        found = 'raw'
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(walk)
    }
  }

  walk(body)
  return found
}

function placementOf(tool: BodyTool, param: string): SentinelPlacement {
  try {
    return classify(JSON.parse(serializeBody(tool, param, VALID_JSON_WITH_SENTINEL)))
  } catch {
    return 'absent'
  }
}

const BODY_PARAM_CASES = BODY_TOOLS.flatMap((tool) =>
  stringParamNames(tool)
    .map((param) => ({
      name: `${tool.id} / ${param}`,
      tool,
      param,
      placement: placementOf(tool, param),
    }))
    .filter(({ placement }) => placement !== 'absent')
)

/**
 * Params the tool actually runs `JSON.parse` on. A malformed value here must
 * raise the folder's named error — substituting an empty value (the original
 * defect) and forwarding the raw string (which reaches Attio as a 400 with no
 * hint of the real cause) are both failures.
 */
const PARSED_PARAM_CASES = BODY_PARAM_CASES.filter(({ placement }) => placement === 'parsed')

/** Plain-text params, which must forward whatever they are given untouched. */
const PASSTHROUGH_PARAM_CASES = BODY_PARAM_CASES.filter(({ placement }) => placement === 'raw')

describe('attio JSON parse integrity', () => {
  it('discovers the body-bound params it is meant to cover', () => {
    expect(BODY_PARAM_CASES.length).toBeGreaterThanOrEqual(20)
  })

  it('discovers every JSON-parsed param', () => {
    expect(PARSED_PARAM_CASES.length).toBeGreaterThanOrEqual(18)
  })

  it.each(PARSED_PARAM_CASES)(
    '$name raises the folder-standard error rather than dropping or forwarding a malformed value',
    ({ tool, param }) => {
      expect(() => serializeBody(tool, param, MALFORMED_JSON_WITH_SENTINEL)).toThrow(
        /Invalid JSON provided/
      )
    }
  )

  it.each(PARSED_PARAM_CASES)('$name still accepts a well-formed value', ({ tool, param }) => {
    expect(() => serializeBody(tool, param, VALID_JSON_WITH_SENTINEL)).not.toThrow()
  })

  it.each(PASSTHROUGH_PARAM_CASES)(
    '$name forwards a plain-text value untouched',
    ({ tool, param }) => {
      expect(serializeBody(tool, param, MALFORMED_JSON_WITH_SENTINEL)).toContain(SENTINEL)
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

function toolById(id: string): BodyTool {
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
