/**
 * @vitest-environment node
 *
 * Guards every Discord tool that interpolates a parameter into its request
 * path against path traversal.
 *
 * Those parameters are `visibility: 'user-or-llm'`, so prompt injection
 * controls them. Interpolating one raw let a value like `../../users/@me`
 * escape its route once `fetch` normalized the URL, re-aiming the request —
 * and the caller's bot token — at an arbitrary Discord resource, including on
 * DELETE routes such as `discord_delete_message` and `discord_kick_member`.
 *
 * `encodeURIComponent` is NOT a fix: `.` and `..` are unreserved, so they
 * survive encoding untouched and the WHATWG parser then removes them as dot
 * segments. Only value rejection works. Every assertion below resolves the
 * built URL through `new URL(...)` — the same normalization `fetch` performs —
 * because string-matching the template is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import * as discordTools from '@/tools/discord/index'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const ORIGIN = 'https://discord.com'
const API_PREFIX_SEGMENTS = ['', 'api', 'v10'] as const

/** Vectors the guard must reject outright; encoding cannot neutralize them. */
const REJECTED = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

/**
 * Vectors `encodeURIComponent` genuinely does neutralize — `%` and `?` are
 * escaped, so the value stays one inert segment. These must NOT throw, and
 * they are the vectors that reach a *second* path parameter: a rejected value
 * throws at the first guard, masking an unguarded one further along.
 */
const NEUTRALIZED = ['%2e%2e', '..%2f..', 'x?foo=attacker'] as const

/** Values a real caller supplies; every one must survive byte-identical. */
const LEGITIMATE = ['123456789012345678', 'abc-DEF_123', '..foo', 'foo..'] as const

/**
 * Legitimate values whose canonical form is percent-encoded, so they cannot be
 * checked against the raw segment the way {@link LEGITIMATE} is.
 *
 * `emoji` is the parameter where encoding is semantically load-bearing:
 * Discord's reaction routes take the emoji as a path segment, and a custom
 * emoji is spelled `name:id` while a unicode emoji is multi-byte. Both must
 * land as exactly ONE segment that decodes back to what the caller typed — an
 * emoji that leaked its `:` or split across segments would address a different
 * route entirely.
 */
const ENCODED_LEGITIMATE = ['smile:12345', '🎉', '👍🏽', 'a b'] as const

function isDiscordTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('discord_') &&
    typeof (value as AnyTool).request?.url === 'function'
  )
}

function safeValueFor(name: string): string {
  return `SAFE${name}`
}

/**
 * Fills every declared param with a legitimate, per-param-unique value, then
 * overrides `target` with `value`. Non-string params get type-appropriate
 * stand-ins so the URL builder runs to completion.
 */
function buildParams(tool: AnyTool, target: string, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === target) {
      params[name] = value
      continue
    }
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') params[name] = []
    else if (type === 'number') params[name] = 1
    else if (type === 'boolean') params[name] = false
    else params[name] = safeValueFor(name)
  }
  return params
}

function buildUrl(tool: AnyTool, target: string, value: string): URL {
  return new URL((tool.request!.url as (p: any) => string)(buildParams(tool, target, value)))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

interface PathSite {
  name: string
  tool: AnyTool
  param: string
}

/**
 * Discovers path-zone parameters reflectively rather than by grep: a tool may
 * assign into a local variable before interpolating, which a grep for
 * `params.x` inside the template would miss.
 */
function collectPathSites(): { sites: PathSite[]; unbuildable: string[] } {
  const sites: PathSite[] = []
  const unbuildable: string[] = []
  for (const tool of Object.values(discordTools)) {
    if (!isDiscordTool(tool)) continue
    for (const [param, def] of Object.entries(tool.params ?? {})) {
      if ((def as { type?: string }).type !== 'string') continue
      const probe = 'ZQPROBEQZ'
      let url: URL
      try {
        url = buildUrl(tool, param, probe)
      } catch (error) {
        unbuildable.push(`${tool.id}.${param}: ${(error as Error).message}`)
        continue
      }
      if (!url.pathname.includes(probe)) continue
      sites.push({ name: `${tool.id}.${param}`, tool, param })
    }
  }
  return { sites, unbuildable }
}

const { sites: PATH_SITES, unbuildable: UNBUILDABLE } = collectPathSites()

/**
 * The exact number of path-zone parameters across the Discord tool set.
 *
 * Exact, not a floor: a floor lets sites silently STOP being discovered — a
 * URL builder that starts throwing, a param retyped away from `string`, a tool
 * dropped from the barrel — while the suite still reports green. Raise this
 * deliberately when a tool or a path parameter is added.
 */
const EXPECTED_PATH_SITES = 60

/** Multi-path-parameter tools, where the independence block below has teeth. */
const EXPECTED_MULTI_PARAM_TOOLS = 17

describe('discord path-parameter traversal safety', () => {
  it('covers every Discord tool parameter that reaches the request path', () => {
    expect(PATH_SITES.length).toBe(EXPECTED_PATH_SITES)
  })

  /**
   * Discovery tolerates a URL builder that throws on a legitimate probe value,
   * because a tool may reject a *different* parameter first. Tolerating it
   * silently is the hazard: a tool that became entirely unbuildable would drop
   * out of PATH_SITES and read as covered. Every skip is recorded and this
   * assertion names it.
   */
  it('builds a URL for every declared string parameter', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  describe.each(PATH_SITES)('$name', ({ tool, param }) => {
    const baseline = segmentsOf(buildUrl(tool, param, safeValueFor(param)))
    const marker = safeValueFor(param)

    it.each(REJECTED)('rejects %j instead of reshaping the path', (value) => {
      expect(() => buildUrl(tool, param, value)).toThrow(new RegExp(param))
    })

    it.each(NEUTRALIZED)('neutralizes %j into a single inert segment', (value) => {
      const url = buildUrl(tool, param, value)
      const actual = segmentsOf(url)

      expect(url.origin).toBe(ORIGIN)
      expect(actual.slice(0, API_PREFIX_SEGMENTS.length)).toEqual([...API_PREFIX_SEGMENTS])
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === marker) return
        expect(actual[index]).toBe(segment)
      })
      expect(url.searchParams.get('foo')).toBeNull()
    })

    it.each(LEGITIMATE)('passes %j through byte-identical', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        expect(actual[index]).toBe(segment === marker ? value : segment)
      })
    })

    it.each(ENCODED_LEGITIMATE)('lands %j as one segment that decodes back', (value) => {
      const actual = segmentsOf(buildUrl(tool, param, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment !== marker) {
          expect(actual[index]).toBe(segment)
          return
        }
        expect(actual[index]).not.toContain('/')
        expect(decodeURIComponent(actual[index])).toBe(value)
      })
    })
  })
})

/**
 * The independence check. Poisoning *every* parameter at once passes even when
 * a second path parameter is unguarded, because the first guard throws before
 * the second is ever reached. Each case below poisons exactly one parameter
 * and leaves the rest legitimate.
 */
describe('guards every path param independently', () => {
  const MULTI_PARAM_TOOLS = PATH_SITES.reduce<Map<string, PathSite[]>>((acc, site) => {
    const key = site.tool.id
    acc.set(key, [...(acc.get(key) ?? []), site])
    return acc
  }, new Map())

  const MULTI = [...MULTI_PARAM_TOOLS.entries()]
    .filter(([, sites]) => sites.length > 1)
    .map(([id, sites]) => ({ id, sites }))

  it('finds multi-segment templates to check', () => {
    expect(MULTI.length).toBe(EXPECTED_MULTI_PARAM_TOOLS)
  })

  describe.each(MULTI)('$id', ({ sites }) => {
    it.each(sites.map((s) => s.param))('rejects a bare ".." in %s alone', (param) => {
      const site = sites.find((s) => s.param === param)!
      expect(() => buildUrl(site.tool, param, '..')).toThrow(new RegExp(param))
    })

    it.each(sites.map((s) => s.param))(
      'keeps the path shape when only %s carries an encoded vector',
      (param) => {
        const site = sites.find((s) => s.param === param)!
        const baseline = segmentsOf(buildUrl(site.tool, param, safeValueFor(param)))
        const actual = segmentsOf(buildUrl(site.tool, param, '..%2f..'))

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          if (segment === safeValueFor(param)) return
          expect(actual[index]).toBe(segment)
        })
      }
    )
  })
})

/**
 * `emoji` and `userId` on the reaction routes, asserted concretely rather than
 * reflectively. Discord's OpenAPI spec declares deleting a reaction as two
 * separate routes: `.../reactions/{emoji_name}/@me` (`delete_my_message_reaction`,
 * where `@me` is a LITERAL segment) and `.../reactions/{emoji_name}/{user_id}`
 * (`delete_user_message_reaction`, where `{user_id}` is a snowflake).
 */
describe('discord reaction route shape', () => {
  const reactionParams = {
    botToken: 'token',
    channelId: '111111111111111111',
    messageId: '222222222222222222',
    serverId: '333333333333333333',
  }

  const removeUrl = (overrides: Record<string, unknown>) =>
    new URL(
      (discordTools.discordRemoveReactionTool.request.url as (p: any) => string)({
        ...reactionParams,
        ...overrides,
      })
    )

  it('escapes the colon of a custom emoji so it stays one segment', () => {
    const url = removeUrl({ emoji: 'smile:12345' })
    const segments = segmentsOf(url)
    const emojiIndex = segments.indexOf('reactions') + 1

    expect(segments[emojiIndex]).toBe('smile%3A12345')
    expect(decodeURIComponent(segments[emojiIndex])).toBe('smile:12345')
  })

  it('keeps a unicode emoji in a single segment', () => {
    const segments = segmentsOf(removeUrl({ emoji: '🎉' }))
    const emojiIndex = segments.indexOf('reactions') + 1

    expect(segments).toHaveLength(emojiIndex + 2)
    expect(decodeURIComponent(segments[emojiIndex])).toBe('🎉')
  })

  it.each([undefined, '', '   '])(
    'targets the literal /@me own-reaction route when userId is %j',
    (userId) => {
      expect(segmentsOf(removeUrl({ emoji: '🎉', userId })).at(-1)).toBe('@me')
    }
  )

  it('treats a literal "@me" as the own-reaction route rather than encoding it to %40me', () => {
    expect(segmentsOf(removeUrl({ emoji: '🎉', userId: '@me' })).at(-1)).toBe('@me')
    expect(segmentsOf(removeUrl({ emoji: '🎉', userId: '  @me  ' })).at(-1)).toBe('@me')
  })

  it('still routes a real snowflake to the user-reaction route', () => {
    expect(segmentsOf(removeUrl({ emoji: '🎉', userId: '444444444444444444' })).at(-1)).toBe(
      '444444444444444444'
    )
  })

  it('adds a reaction on the same literal /@me route', () => {
    const url = new URL(
      (discordTools.discordAddReactionTool.request.url as (p: any) => string)({
        ...reactionParams,
        emoji: 'smile:12345',
      })
    )
    const segments = segmentsOf(url)

    expect(segments.at(-1)).toBe('@me')
    expect(segments.at(-2)).toBe('smile%3A12345')
  })
})
