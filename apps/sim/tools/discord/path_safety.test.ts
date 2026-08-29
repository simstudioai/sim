/**
 * @vitest-environment node
 *
 * Guards every Discord tool against path traversal through an LLM-writable ID
 * that gets interpolated into the request path.
 *
 * Guild, channel, message, user, role, webhook, and invite IDs are
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Interpolating
 * one raw let a value like `../../guilds/victim` escape its `/api/v10` prefix
 * once `fetch` normalized the URL, re-aiming the request — and the workspace's
 * Discord bot token — at an arbitrary Discord resource, including on the DELETE
 * channel, DELETE role, and ban routes.
 *
 * `encodeURIComponent` is NOT enough, which is why the vector list below keeps
 * the bare `.` and `..` segments: both are made of unreserved characters, so
 * they survive encoding untouched and the URL parser then removes them as dot
 * segments, popping one path segment off a fixed host. Every assertion here
 * resolves the built URL with `new URL(...)` — the same normalization `fetch`
 * performs — rather than string-matching the template output, because string
 * matching is exactly what let this through.
 *
 * The tool list is enumerated from the barrel, so a newly added Discord tool
 * that interpolates an unguarded ID fails here without anyone editing this file.
 */
import { describe, expect, it } from 'vitest'
import * as discordTools from '@/tools/discord'
import { discordAssignRoleTool } from '@/tools/discord/assign_role'
import { discordGetMemberTool } from '@/tools/discord/get_member'
import type { ToolConfig } from '@/tools/types'

const API_ORIGIN = 'https://discord.com'
const API_PREFIX = '/api/v10/'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix looks correct while the hole stays live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../guilds/987654321098765432',
  '..%2f..%2fguilds/987654321098765432',
  '123456789012345678/../../../guilds/987654321098765432',
  '123456789012345678?with_counts=false',
  '123456789012345678#fragment',
  '123456789012345678/messages/../../../users/@me',
  '\\..\\..',
] as const

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
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { botToken: 'bot-token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'botToken') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array' || type === 'file[]') {
      params[name] = []
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

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(discordTools)
  .filter(isDiscordTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return buildUrl(tool, SAFE_ID).pathname.includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('discord path-ID traversal safety', () => {
  it('covers every Discord tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(30)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID).pathname)

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe(API_ORIGIN)
      expect(url.pathname.startsWith(API_PREFIX)).toBe(true)

      const actual = segmentsOf(url.pathname)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping the prefix', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal is not allowed/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal is not allowed/)
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value).pathname)

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === SAFE_ID ? value : segment)
      })
    })

    it('trims surrounding whitespace off a snowflake', () => {
      const actual = segmentsOf(buildUrl(tool, '  123456789012345678  ').pathname)

      baseline.forEach((segment, index) => {
        if (segment !== SAFE_ID) return
        expect(actual[index]).toBe('123456789012345678')
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
