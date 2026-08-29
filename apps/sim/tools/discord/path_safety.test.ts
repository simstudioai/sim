/**
 * @vitest-environment node
 *
 * Guards every Discord tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * Guild, channel, message, user, role, webhook, and invite IDs are
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Interpolating
 * one raw let a value like `../../guilds/987654321098765432` escape its
 * `/api/v10` prefix once `fetch` normalized the URL, re-aiming the request —
 * and the workspace's Discord bot token — at an arbitrary Discord resource,
 * including on the DELETE channel, DELETE role, and ban routes.
 *
 * `encodeURIComponent` is NOT enough, which is why the vector list below keeps
 * the bare `.` and `..` segments: both are made of unreserved characters, so
 * they survive encoding untouched and the URL parser then removes them as dot
 * segments, popping one path segment off a fixed host. Every assertion here
 * resolves the built URL with `new URL(...)` — the same normalization `fetch`
 * performs — rather than string-matching the template output, because string
 * matching is exactly what let this through.
 *
 * The suite enumerates **(tool, param) pairs** and fuzzes one param at a time,
 * holding every sibling at a safe value. Fuzzing all params at once cannot work
 * here: the first guard to throw aborts URL construction, so a tool's remaining
 * params stop being exercised the moment one of them is fixed. Pair enumeration
 * is what makes "a newly unguarded param fails CI" actually true for a tool that
 * already has a guarded param — the dominant shape in this service, where
 * `channelId` + `messageId` and `serverId` + `roleId` share one path.
 */
import { describe, expect, it } from 'vitest'
import * as discordTools from '@/tools/discord'
import { discordAssignRoleTool } from '@/tools/discord/assign_role'
import { discordGetMemberTool } from '@/tools/discord/get_member'
import type { ToolConfig } from '@/tools/types'

const API_ORIGIN = 'https://discord.com'
const API_PREFIX = '/api/v10/'
const CREDENTIAL_PARAM = 'botToken'

/**
 * Vectors the guard must **reject outright**. Each is either a bare dot segment
 * or carries a path separator, so encoding it would leave a live traversal.
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const MUST_REJECT = [
  '..',
  '.',
  '  ..  ',
  '../../guilds/987654321098765432',
  '..%2f..%2fguilds/987654321098765432',
  '123456789012345678/../../../guilds/987654321098765432',
  '123456789012345678/messages/../../../users/@me',
  '\\..\\..',
] as const

/**
 * Vectors that are not traversals but must not be able to reshape the request:
 * a `?` or `#` inside a segment has to stay inside that segment.
 */
const MUST_NEUTRALIZE = ['123456789012345678?with_counts=false', '123456789012345678#frag'] as const

/**
 * Values a real user legitimately supplies; none may be rejected or altered.
 *
 * Discord IDs are snowflakes — 17 to 19 digit decimal strings — so the numeric
 * spellings here are the shape that actually reaches these tools in production.
 */
const LEGITIMATE_IDS = [
  '12345678901234567',
  '123456789012345678',
  '1234567890123456789',
  '80351110224678912',
  'general',
  'aBcDeF1',
  '..foo',
  'foo..',
  'v1.2.3',
] as const

const SAFE_ID = 'SAFEID'
const PROBE = 'PROBEVALUE'
const TRIM_SAMPLE = '123456789012345678'

type AnyTool = ToolConfig<any, any>

function isDiscordTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('discord_')
  )
}

/**
 * Builds a param object with every string param at a known-safe value, then
 * applies one override so exactly one param carries the value under test.
 */
function buildParams(
  tool: AnyTool,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const params: Record<string, unknown> = { [CREDENTIAL_PARAM]: 'bot-token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === CREDENTIAL_PARAM) continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array' || type === 'file[]') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: AnyTool, overrides: Record<string, unknown> = {}): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, overrides) as any))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const TOOLS = Object.values(discordTools)
  .filter(isDiscordTool)
  .filter((tool) => typeof tool.request?.url === 'function')

/**
 * Every (tool, param) pair where that param alone reaches the request path,
 * discovered by probing one param at a time. A newly added tool — or a newly
 * added path param on an existing tool — appears here with no edit to this file.
 */
const PATH_PARAM_PAIRS = TOOLS.flatMap((tool) =>
  Object.keys(tool.params ?? {})
    .filter((param) => param !== CREDENTIAL_PARAM)
    .filter((param) => {
      try {
        return buildUrl(tool, { [param]: PROBE }).pathname.includes(PROBE)
      } catch {
        return false
      }
    })
    .map((param) => ({ name: `${tool.id} / ${param}`, tool, param }))
)

describe('discord path-param traversal safety', () => {
  it('finds every (tool, param) pair that reaches the request path', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(60)
  })

  it('covers multi-param paths, where whole-object fuzzing goes blind', () => {
    const counts = new Map<string, number>()
    for (const { tool } of PATH_PARAM_PAIRS) {
      counts.set(tool.id, (counts.get(tool.id) ?? 0) + 1)
    }
    const multiParamTools = [...counts.values()].filter((count) => count > 1)

    expect(multiParamTools.length).toBeGreaterThanOrEqual(15)
  })

  describe.each(PATH_PARAM_PAIRS)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, { [param]: PROBE }).pathname)

    it.each(MUST_REJECT)('rejects %j outright', (value) => {
      expect(() => buildUrl(tool, { [param]: value })).toThrow(
        new RegExp(`${param}|path traversal|path separator`)
      )
    })

    it.each(MUST_NEUTRALIZE)('confines %j to a single segment', (value) => {
      const url = buildUrl(tool, { [param]: value })

      expect(url.origin).toBe(API_ORIGIN)
      expect(url.pathname.startsWith(API_PREFIX)).toBe(true)
      expect(url.hash).toBe('')

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment.includes(PROBE)) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, { [param]: value }).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(PROBE, value))
      })
    })

    it('trims surrounding whitespace off a legitimate value', () => {
      const actual = segmentsOf(buildUrl(tool, { [param]: `  ${TRIM_SAMPLE}  ` }).pathname)

      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment.replaceAll(PROBE, TRIM_SAMPLE))
      })
    })
  })
})

/**
 * An LLM tool call carries JSON, so a snowflake can arrive as a `number` rather
 * than the declared `string`. The guard must not turn that into a bogus segment.
 *
 * A snowflake wider than `Number.MAX_SAFE_INTEGER` has already lost digits by
 * the time `JSON.parse` finished, so it is refused by name instead of silently
 * addressing a neighbouring resource. A snowflake that survives as a `bigint`,
 * and any numeric id inside the safe range, pass through as their decimal text.
 */
describe('discord snowflakes supplied as JSON numbers', () => {
  it('accepts a numeric id inside the safe integer range', () => {
    const url = new URL(
      discordGetMemberTool.request.url({
        botToken: 'bot-token',
        serverId: 8035111022467891,
        userId: 8035111022467892,
      } as any)
    )

    expect(url.pathname).toBe('/api/v10/guilds/8035111022467891/members/8035111022467892')
  })

  it('accepts a full-width snowflake supplied as a bigint', () => {
    const url = new URL(
      discordGetMemberTool.request.url({
        botToken: 'bot-token',
        serverId: 1234567890123456789n,
        userId: 987654321098765432n,
      } as any)
    )

    expect(url.pathname).toBe('/api/v10/guilds/1234567890123456789/members/987654321098765432')
  })

  it('refuses a snowflake JSON.parse already rounded rather than addressing the wrong resource', () => {
    const roundedSnowflake = Number('1234567890123456789')

    expect(roundedSnowflake).not.toBe(1234567890123456789n)

    expect(() =>
      discordAssignRoleTool.request.url({
        botToken: 'bot-token',
        serverId: roundedSnowflake,
        userId: '123456789012345678',
        roleId: '123456789012345678',
      } as any)
    ).toThrow(/serverId is too large to be represented exactly/)
  })
})
