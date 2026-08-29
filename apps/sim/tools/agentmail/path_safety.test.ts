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
 * Every assertion here resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 *
 * An AgentMail inbox ID legitimately *is* an email address, so the guard now
 * percent-encodes the `@`. The legitimate-value assertions below therefore
 * check the segment round-trips through `decodeURIComponent` back to the exact
 * value supplied, which is the property AgentMail's own Node SDK relies on: it
 * wraps every path parameter in `encodeURIComponent` (`core/url/encodePathParam`),
 * while the Python SDK sends the address raw — both ship, so the server decodes
 * percent-encoding normally.
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
  'me@agentmail.to?limit=100',
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

const SAFE_ID = 'SAFEID'

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
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { apiKey: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'apiKey') continue
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
      params[name] = value
    }
  }
  return params
}

function buildUrl(tool: AnyTool, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(agentmailTools)
  .filter(isAgentmailTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('agentmail path-ID traversal safety', () => {
  it('covers every AgentMail tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(17)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.agentmail.to')

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(SAFE_ID)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(TRAVERSAL_IDS.filter((value) => value.trim() === '.' || value.trim() === '..'))(
      'rejects the bare dot segment %j by name instead of popping the prefix',
      (value) => {
        expect(() => buildUrl(tool, value)).toThrow(/Id/)
      }
    )

    it('does not let an ID inject a query parameter', () => {
      const url = buildUrl(tool, 'me@agentmail.to?injectedParam=attacker')

      expect(url.searchParams.get('injectedParam')).toBeNull()
    })

    it.each(LEGITIMATE_IDS)('round-trips %j through the path unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        const expected = segment.replaceAll(SAFE_ID, value)
        expect(decodeURIComponent(actual[index])).toBe(expected)
      })
    })

    it('percent-encodes an email-address inbox ID rather than rejecting it', () => {
      const url = buildUrl(tool, 'example@agentmail.to')

      expect(url.pathname).toContain('example%40agentmail.to')
      expect(decodeURIComponent(url.pathname)).toContain('example@agentmail.to')
    })

    it('trims surrounding whitespace rather than encoding it into the path', () => {
      const actual = segmentsOf(buildUrl(tool, `  ${SAFE_ID}  `))

      expect(actual).toEqual(baseline)
    })
  })
})
