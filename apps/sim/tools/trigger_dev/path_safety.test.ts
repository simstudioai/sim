/**
 * @vitest-environment node
 *
 * Guards every Trigger.dev tool against path traversal through an LLM-writable
 * ID that gets interpolated into the request path.
 *
 * These IDs are `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Interpolating one raw let a value like `../../v3/runs/victim` escape its API
 * prefix once `fetch` normalized the URL, re-aiming the request (and the user's
 * Trigger.dev secret key) at an arbitrary Trigger.dev resource — including on
 * the DELETE routes for schedules and environment variables.
 * `assertRequestUrlMatchesTrust` in `tools/request-transport.ts` only applies
 * its canonicalization guard to internal `/api/` routes, so nothing downstream
 * catches this.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * The unit under test is a **(tool, parameter) pair**, not a tool. Fuzzing every
 * string parameter of a tool at once hides siblings: the first guarded parameter
 * throws, the `catch` swallows the whole vector, and every remaining parameter on
 * that tool goes unexercised. The environment-variable tools are the sharpest
 * case — `buildTriggerDevEnvVarsUrl` interpolates `projectRef`, `environment`,
 * AND `name` into one path, so guarding only the first would have read as full
 * coverage. Each parameter is therefore fuzzed alone, with every sibling pinned
 * to a safe value, and the pairs are discovered by probing rather than listed by
 * hand, so a new tool — or a new path parameter on an existing tool — joins the
 * matrix on arrival.
 */
import { describe, expect, it } from 'vitest'
import * as triggerDevTools from '@/tools/trigger_dev/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../v3/runs/run_victim',
  '..%2f..%2fv3/runs/run_victim',
  'run_abc123/../../../v3/runs/run_victim',
  'run_abc123?bulkActionId=attacker',
  'run_abc123#fragment',
  'run_abc123/trace/../../../v1/schedules',
  '\\..\\..',
] as const

/** Values a real user legitimately supplies; none may be rejected or altered. */
const LEGITIMATE_IDS = [
  'run_abc123',
  'batch_9xkq2m',
  'sched_1a2b3c4d',
  'queue_mainWorker',
  'waitpoint_ab12cd34',
  'my-task-identifier',
  'my.task.identifier',
  'prod',
  '20250101.1',
  '..foo',
  'foo..',
] as const

/** Pinned into every sibling parameter so only the fuzzed one can move. */
const SIBLING_ID = 'SIBLINGID'

/** Distinguishes the fuzzed parameter's slots from every other path segment. */
const TARGET_ID = 'TARGETID'

const PADDED_ID = 'run_abc123'

type AnyTool = ToolConfig<any, any>

function isTriggerDevTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('trigger_dev_')
  )
}

/**
 * Builds a param object for a tool, pinning every declared string param to
 * `SIBLING_ID` except `target`, which carries the value under test.
 */
function buildParams(tool: AnyTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = name === target ? value : SIBLING_ID
    }
  }
  return params
}

function buildUrl(tool: AnyTool, target: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, target, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Discovers every (tool, parameter) pair whose parameter reaches the path, by
 * marking one parameter at a time and checking whether the marker survives into
 * `pathname`. Probing rather than listing is what makes a newly added path
 * parameter fail this suite without anyone remembering to register it.
 */
const PATH_PARAM_PAIRS = Object.values(triggerDevTools)
  .filter(isTriggerDevTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((name) => name !== 'apiKey')
      .filter((name) => {
        try {
          return buildUrl(tool, name, TARGET_ID).pathname.includes(TARGET_ID)
        } catch {
          return false
        }
      })
      .map((param) => ({ name: `${tool.id} / ${param}`, tool, param }))
  )

describe('Trigger.dev path-parameter traversal safety', () => {
  it('covers every (tool, parameter) pair that reaches the request path', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(35)
  })

  /**
   * The env-var endpoints put three separate LLM-writable values into one path.
   * Named explicitly so a regression that drops any single guard is legible in
   * the failure output rather than lost in the generated matrix.
   */
  it('covers all three path parameters of every env-var tool', () => {
    const envVarPairs = PATH_PARAM_PAIRS.filter(({ name }) => name.includes('env_var'))
    const byTool = new Map<string, string[]>()
    for (const { tool, param } of envVarPairs) {
      byTool.set(tool.id, [...(byTool.get(tool.id) ?? []), param])
    }

    expect(byTool.size).toBeGreaterThanOrEqual(4)
    for (const params of byTool.values()) {
      expect(params).toEqual(expect.arrayContaining(['projectRef', 'environment']))
    }
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, param, TARGET_ID))

    it('reaches the path in at least one segment', () => {
      expect(baseline).toContain(TARGET_ID)
    })

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, param, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.trigger.dev')

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === TARGET_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === TARGET_ID ? value : segment)
      })
    })

    it('rejects a bare dot-dot segment, naming the offending parameter', () => {
      expect(() => buildUrl(tool, param, '..')).toThrow(new RegExp(param))
    })

    it('rejects a bare dot segment, naming the offending parameter', () => {
      expect(() => buildUrl(tool, param, '.')).toThrow(new RegExp(param))
    })

    it('trims surrounding whitespace without altering the id', () => {
      const padded = segmentsOf(buildUrl(tool, param, `  ${PADDED_ID}  `))

      expect(padded).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(padded[index]).toBe(segment === TARGET_ID ? PADDED_ID : segment)
      })
    })

    it('does not let the id inject query parameters', () => {
      const url = buildUrl(tool, param, `${PADDED_ID}?bulkActionId=attacker`)

      expect(url.searchParams.get('bulkActionId')).not.toBe('attacker')
    })
  })
})

describe('trigger_dev_create_waitpoint_token does not shadow the transport deadline', () => {
  const tool = triggerDevTools.triggerDevCreateWaitpointTokenTool

  it('does not declare a param named "timeout"', () => {
    expect(Object.keys(tool.params ?? {})).not.toContain('timeout')
  })

  it('sends the waitpoint timeout in the request body', () => {
    const body = tool.request?.body?.({
      apiKey: 'tr_test',
      waitpointTimeout: '1d',
    } as never) as Record<string, unknown>

    expect(body.timeout).toBe('1d')
  })
})
