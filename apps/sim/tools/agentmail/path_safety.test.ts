/**
 * @vitest-environment node
 *
 * Guards every AgentMail tool against path traversal through an LLM-writable
 * ID that gets interpolated into the request path.
 *
 * `inboxId`, `threadId`, `messageId`, and `draftId` are all
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Each one was
 * interpolated raw (`${params.inboxId.trim()}`), which let a value like
 * `../../inboxes/victim@agentmail.to` escape its `/v0/inboxes/<id>` prefix once
 * `fetch` normalized the URL — re-aiming the request, and the workspace's
 * AgentMail API key, at somebody else's inbox. `delete_inbox`, `delete_thread`
 * and `delete_draft` are DELETEs, so the reachable damage is destructive.
 *
 * Wrapping the ID in `encodeURIComponent` is NOT enough, which is why the
 * vector list below includes the bare `.` and `..` segments: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * The clearest demonstration is the sibling Algolia suite, whose call sites
 * already wrapped every ID in `encodeURIComponent` and still failed precisely
 * — and only — on the bare `.` and `..` vectors.
 *
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * **The suite enumerates (tool, parameter) pairs and fuzzes exactly one
 * parameter at a time**, holding every sibling at a known-safe value. Filling
 * every string parameter with the same hostile value and swallowing the throw
 * — the shape this file originally copied — silently stops testing a tool's
 * remaining IDs the moment one of them is guarded, so a route like
 * `/inboxes/{inboxId}/threads/{threadId}` would have been reported as covered
 * while `threadId` was never exercised at all.
 *
 * An AgentMail inbox ID legitimately *is* an email address, so the guard now
 * percent-encodes the `@`. The legitimate-value assertions below therefore
 * check the segment round-trips through `decodeURIComponent` back to the exact
 * value supplied, which is the property AgentMail's own Node SDK relies on: it
 * wraps every path parameter in `encodeURIComponent`
 * (`core/url/encodePathParam`), while the Python SDK sends the address raw —
 * both ship, so the server decodes percent-encoding normally.
 */
import { describe, expect, it } from 'vitest'
import * as agentmailTools from '@/tools/agentmail/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../inboxes/victim@agentmail.to',
  '..%2f..%2finboxes/victim@agentmail.to',
  'me@agentmail.to/../../inboxes/victim@agentmail.to',
  'me@agentmail.to?injectedParam=attacker',
  'me@agentmail.to#fragment',
  'me@agentmail.to/threads/../../../v0/inboxes',
  '\\..\\..',
] as const

/**
 * Values a real user legitimately supplies; none may be rejected, and each must
 * survive the round trip byte for byte.
 */
const LEGITIMATE_IDS = [
  'example@agentmail.to',
  'sales-team@agentmail.to',
  'support.desk@agentmail.to',
  'msg_01HQ8ZK3TVN4XR',
  'thread_2W7QpN8xkE4hVvRt6bLd',
  'draft-abc-123',
  '..foo',
  'foo..',
] as const

/** The value under test; unique so its position in the path is unambiguous. */
const TARGET = 'TARGETID'

/** Every other string parameter is pinned here so only one variable moves. */
const SIBLING = 'SIBLINGID'

const ORIGIN = 'https://api.agentmail.to'

type AnyTool = ToolConfig<any, any>

function isAgentmailTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('agentmail_')
  )
}

/**
 * Builds a param object with `targetName` set to `value` and every other
 * parameter pinned to a known-safe placeholder of the right shape, so a failure
 * is always attributable to the one parameter under test.
 */
function buildParams(tool: AnyTool, targetName: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
    if (name === targetName) {
      params[name] = value
      continue
    }
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'object') {
      params[name] = {}
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SIBLING
    }
  }
  return params
}

function buildUrl(tool: AnyTool, targetName: string, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, targetName, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

/**
 * Every (tool, parameter) pair whose parameter actually reaches the path, found
 * by probing one parameter at a time with a unique marker.
 */
const PATH_PARAM_PAIRS = Object.values(agentmailTools)
  .filter(isAgentmailTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .flatMap((tool) =>
    Object.keys(tool.params ?? {})
      .filter((paramName) => paramName !== 'apiKey')
      .filter((paramName) => {
        try {
          return buildUrl(tool, paramName, TARGET).pathname.includes(TARGET)
        } catch {
          return false
        }
      })
      .map((paramName) => ({ name: `${tool.id} / ${paramName}`, tool, paramName }))
  )

describe('agentmail path-ID traversal safety', () => {
  it('covers every AgentMail path parameter, not just the first per tool', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(30)
  })

  it('exercises the second ID of every two-ID route', () => {
    const covered = new Set(PATH_PARAM_PAIRS.map((pair) => pair.name))

    expect(covered).toContain('agentmail_delete_thread / threadId')
    expect(covered).toContain('agentmail_get_thread / threadId')
    expect(covered).toContain('agentmail_update_thread / threadId')
    expect(covered).toContain('agentmail_get_message / messageId')
    expect(covered).toContain('agentmail_update_message / messageId')
    expect(covered).toContain('agentmail_forward_message / messageId')
    expect(covered).toContain('agentmail_reply_message / messageId')
    expect(covered).toContain('agentmail_delete_draft / draftId')
    expect(covered).toContain('agentmail_get_draft / draftId')
    expect(covered).toContain('agentmail_send_draft / draftId')
    expect(covered).toContain('agentmail_update_draft / draftId')
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, paramName }) => {
    const baseline = segmentsOf(buildUrl(tool, paramName, TARGET))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, paramName, value)
      } catch (error) {
        expect(String(error)).toContain(paramName)
        return
      }

      expect(url.origin).toBe(ORIGIN)
      expect(url.searchParams.get('injectedParam')).toBeNull()

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(TARGET)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(['..', '.', '  ..  '])('rejects the bare dot segment %j by name', (value) => {
      expect(() => buildUrl(tool, paramName, value)).toThrow(new RegExp(paramName))
    })

    it.each(LEGITIMATE_IDS)('round-trips %j through the path unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, paramName, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(decodeURIComponent(actual[index])).toBe(segment.replaceAll(TARGET, value))
      })
    })

    it('percent-encodes an email-address ID rather than rejecting it', () => {
      const url = buildUrl(tool, paramName, 'example@agentmail.to')

      expect(url.pathname).toContain('example%40agentmail.to')
      expect(decodeURIComponent(url.pathname)).toContain('example@agentmail.to')
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      expect(segmentsOf(buildUrl(tool, paramName, `  ${TARGET}  `))).toEqual(baseline)
    })
  })
})
