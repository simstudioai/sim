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
 * `encodeURIComponent` is NOT enough: `.` and `..` are unreserved, so they
 * survive encoding untouched and the URL parser then removes them as dot
 * segments. Every assertion here resolves the built URL with `new URL(...)` —
 * the same normalization `fetch` performs — rather than string-matching the
 * template output, because string matching is what let this through.
 *
 * Two independent blind spots shape this file, and both are load-bearing:
 *
 * 1. **Fuzz one param at a time.** URL construction is eager, so filling every
 *    param with the same vector means the first guard to throw aborts the whole
 *    case and every sibling goes untested — once a tool has one guard, a newly
 *    unguarded sibling can no longer fail CI. So the suite enumerates
 *    (tool, param) pairs and holds every sibling at a safe value.
 * 2. **Assert rejection, not just shape.** A bare `.` in the FINAL segment
 *    collapses invisibly: `/channels/123/messages/.` normalizes to
 *    `/channels/123/messages/`, which keeps the segment count and every other
 *    segment intact, so a shape-only check passes with the guard removed. Since
 *    the guarded id is the last segment on `delete_message`, `delete_channel`,
 *    `delete_role` and friends — all DELETEs — that is exactly where a shape
 *    check is blindest. `MUST_REJECT` therefore asserts a throw.
 */
import { describe, expect, it } from 'vitest'
import * as discordTools from '@/tools/discord'
import { discordAssignRoleTool } from '@/tools/discord/assign_role'
import { discordDeleteMessageTool } from '@/tools/discord/delete_message'
import { discordGetMemberTool } from '@/tools/discord/get_member'

const API_ORIGIN = 'https://discord.com'
const API_PREFIX = '/api/v10/'
const CREDENTIAL_PARAM = 'botToken'

/**
 * Vectors the guard must **reject outright**. Each is a bare dot segment or
 * carries a path separator, so encoding it would leave a live traversal.
 */
const MUST_REJECT = [
  '..',
  '.',
  '  ..  ',
  '  .  ',
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

/**
 * Tools that legitimately build no URL from params, so the pair enumeration
 * cannot reach them. Named explicitly rather than silently skipped: a tool that
 * loses its URL builder — or a new operation-dispatched tool — must surface
 * here rather than quietly dropping out of coverage.
 */
const TOOLS_WITHOUT_PARAM_BUILT_URLS = ['discord_send_message'] as const

const SAFE_ID = 'SAFEID'
const PROBE = 'PROBEVALUE'
const TRIM_SAMPLE = '123456789012345678'

interface PathToolParam {
  type?: string
  required?: boolean
}

/** The structural slice of a tool config this suite needs; avoids `any`. */
interface ServiceTool {
  id: string
  params?: Record<string, PathToolParam>
  request?: { url?: unknown; body?: unknown; headers?: unknown }
}

/** A tool that builds its request URL from params, so it can be probed. */
type PathTool = ServiceTool & {
  request: {
    url: (params: Record<string, unknown>) => string
    body?: (params: Record<string, unknown>) => unknown
    headers?: (params: Record<string, unknown>) => unknown
  }
}

function isDiscordTool(value: unknown): value is ServiceTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ServiceTool).id === 'string' &&
    (value as ServiceTool).id.startsWith('discord_')
  )
}

/**
 * Whether calling `fn` raises a `TypeError` — the signature of a builder that
 * assumed a param was a string (`params.x?.trim is not a function`). Domain
 * errors thrown deliberately by a builder are not TypeErrors, so they pass
 * through and do not cause a false failure here.
 */
function throwsTypeError(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (error) {
    return error instanceof TypeError
  }
}

function isPathTool(tool: ServiceTool): tool is PathTool {
  return typeof tool.request?.url === 'function'
}

function pathToolFor(value: unknown, id: string): PathTool {
  if (!isDiscordTool(value) || !isPathTool(value)) {
    throw new Error(`${id} does not build its URL from params`)
  }
  return value
}

/**
 * Builds a param object with every string param at a known-safe value, then
 * applies one override so exactly one param carries the value under test.
 */
function buildParams(tool: PathTool, overrides: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = { [CREDENTIAL_PARAM]: 'bot-token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === CREDENTIAL_PARAM) continue
    if (def.type === 'json' || def.type === 'array' || def.type === 'file[]') {
      params[name] = []
    } else if (def.type === 'number') {
      params[name] = 1
    } else if (def.type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  return { ...params, ...overrides }
}

function buildUrl(tool: PathTool, overrides: Record<string, unknown> = {}): URL {
  return new URL(tool.request.url(buildParams(tool, overrides)))
}

function segmentsOf(pathname: string): string[] {
  return pathname.split('/')
}

const ALL_TOOLS = Object.values(discordTools).filter(isDiscordTool)
const TOOLS = ALL_TOOLS.filter(isPathTool)

/** Surfaced, not swallowed — a silent skip is the blindness this suite fixes. */
const SKIPPED_TOOL_IDS = ALL_TOOLS.filter((tool) => !isPathTool(tool)).map((tool) => tool.id)

/**
 * Tools whose URL will not build even from all-safe values. Distinct from a
 * probe that throws (probing a *guarded* param is supposed to throw): this
 * means the tool cannot be exercised at all, so it would vanish from coverage
 * rather than fail. Asserted empty.
 */
const UNBUILDABLE: string[] = []

/**
 * String literals the URL builder compares against, harvested from its own
 * source so a branching builder is probed on every branch without this file
 * enumerating them. Neither service switches on a literal today — every match
 * set is currently empty — but a tool added later that picks its endpoint from
 * an `action`/`operation` param would otherwise hide the identifiers that only
 * appear on its non-default branch.
 */
function branchLiterals(tool: PathTool): string[] {
  const source = String(tool.request.url)
  const matches = [...source.matchAll(/[=!]==\s*'([^']{1,64})'|'([^']{1,64})'\s*[=!]==/g)]
  return [...new Set(matches.map((match) => match[1] ?? match[2]).filter(Boolean))]
}

interface ProbeContext {
  label: string
  overrides: Record<string, unknown>
}

/**
 * Sibling contexts to probe each param under. A param that only appears on one
 * branch of a conditional builder is invisible to a single all-params probe —
 * `create_thread` switches on whether `messageId` is present, and
 * `remove_reaction` on whether `userId` is, so the branch taken when they are
 * ABSENT is never reached if discovery always fills them.
 */
function contextsFor(tool: PathTool): ProbeContext[] {
  const contexts: ProbeContext[] = [{ label: 'all params', overrides: {} }]

  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === CREDENTIAL_PARAM || def.required) continue
    contexts.push({ label: `without ${name}`, overrides: { [name]: undefined } })
  }

  for (const literal of branchLiterals(tool)) {
    for (const name of Object.keys(tool.params ?? {})) {
      if (name === CREDENTIAL_PARAM) continue
      contexts.push({ label: `${name}=${literal}`, overrides: { [name]: literal } })
    }
  }

  return contexts
}

interface PathParamCase {
  name: string
  tool: PathTool
  param: string
  overrides: Record<string, unknown>
  baseline: string[]
  /** The query string the tool builds on its own, with no vector involved. */
  baselineSearch: string
}

/**
 * Every (tool, param, branch) case where that param alone reaches the request
 * path, discovered by probing one param at a time under every sibling context.
 * Cases producing an identical path shape are collapsed, so a param guarded the
 * same way on both branches is tested once.
 */
const PATH_PARAM_PAIRS: PathParamCase[] = []
const seenCases = new Set<string>()

for (const tool of TOOLS) {
  for (const context of contextsFor(tool)) {
    for (const param of Object.keys(tool.params ?? {})) {
      if (param === CREDENTIAL_PARAM || param in context.overrides) continue

      let baseline: string[]
      let baselineSearch: string
      try {
        const probed = buildUrl(tool, { ...context.overrides, [param]: PROBE })
        baseline = segmentsOf(probed.pathname)
        baselineSearch = probed.search
      } catch (error) {
        if (context.label === 'all params') {
          UNBUILDABLE.push(`${tool.id} / ${param}: ${(error as Error).message}`)
        }
        continue
      }

      if (!baseline.some((segment) => segment.includes(PROBE))) continue

      const key = `${tool.id}|${param}|${baseline.join('/')}`
      if (seenCases.has(key)) continue
      seenCases.add(key)

      PATH_PARAM_PAIRS.push({
        name: `${tool.id} / ${param}${context.label === 'all params' ? '' : ` (${context.label})`}`,
        tool,
        param,
        overrides: context.overrides,
        baseline,
        baselineSearch,
      })
    }
  }
}

describe('discord path-param traversal safety', () => {
  it('can build every tool that declares a params-based URL', () => {
    expect(UNBUILDABLE).toEqual([])
  })

  it('accounts for every tool that builds no URL from params', () => {
    expect([...SKIPPED_TOOL_IDS].sort()).toEqual([...TOOLS_WITHOUT_PARAM_BUILT_URLS].sort())
  })

  it('finds every (tool, param) pair that reaches the request path', () => {
    expect(PATH_PARAM_PAIRS.length).toBeGreaterThanOrEqual(64)
  })

  /**
   * Ratchets the branch coverage. `create_thread` and `remove_reaction` pick a
   * different path when `messageId` / `userId` are absent; probing only the
   * all-params shape left those branches — and the `/@me` form — untested.
   */
  it('probes conditional builders on their non-default branch too', () => {
    const branchCases = PATH_PARAM_PAIRS.filter((testCase) => testCase.name.includes('(without '))

    expect(branchCases.length).toBeGreaterThanOrEqual(4)
  })

  it('covers multi-param paths, where whole-object fuzzing goes blind', () => {
    const counts = new Map<string, number>()
    for (const { tool } of PATH_PARAM_PAIRS) {
      counts.set(tool.id, (counts.get(tool.id) ?? 0) + 1)
    }

    expect([...counts.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(15)
  })

  describe.each(PATH_PARAM_PAIRS)(
    '$name',
    ({ tool, param, overrides, baseline, baselineSearch }) => {
      const withValue = (value: unknown) => buildUrl(tool, { ...overrides, [param]: value })

      it.each(MUST_REJECT)('rejects %j outright', (value) => {
        expect(() => withValue(value)).toThrow(new RegExp(`${param}|path traversal|path separator`))
      })

      it.each(MUST_NEUTRALIZE)('confines %j to a single segment', (value) => {
        const url = withValue(value)

        expect(url.origin).toBe(API_ORIGIN)
        expect(url.pathname.startsWith(API_PREFIX)).toBe(true)
        expect(url.hash).toBe('')

        /**
         * The query string must be byte-identical to what the tool builds alone.
         * Without this, a raw interpolation of `id?x=y` passes every other
         * assertion here: the `?` starts a query, so the PATH keeps its segment
         * count and every surrounding segment, and only `search` reveals that the
         * id was torn in half. Shape alone cannot see it.
         */
        expect(url.search).toBe(baselineSearch)

        const actual = segmentsOf(url.pathname)
        expect(actual).toHaveLength(baseline.length)
        /**
         * Every segment is pinned, including the one under test — it must equal
         * the trimmed, percent-encoded value. Skipping the probe slot would let a
         * balanced traversal (`id/../../other/victim`) pass with the guard gone,
         * because only that slot changes.
         */
        const expected = encodeURIComponent(value.trim())
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replaceAll(PROBE, expected))
        })
      })

      it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
        const actual = segmentsOf(withValue(value).pathname)

        expect(actual).toHaveLength(baseline.length)
        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replaceAll(PROBE, value))
        })
      })

      /**
       * A safe-range numeric id must build the same path as its decimal string.
       *
       * This is what catches a pre-trim anywhere in a URL builder. A
       * `params.x?.trim()` ahead of the guard throws a bare
       * `TypeError: params.x?.trim is not a function` on a JSON number, and it
       * throws BEFORE `safeUrlPathSegment` — which accepts numbers and bigints —
       * ever runs. The first version of this suite passed only strings, so the
       * `remove_reaction` and `create_thread` pre-trims survived it; both bots
       * caught what the harness could not.
       */
      it('accepts a safe-range numeric id identically to its decimal string', () => {
        const numeric = 8035111022467891

        expect(segmentsOf(withValue(numeric).pathname)).toEqual(
          segmentsOf(withValue(String(numeric)).pathname)
        )
      })

      it('accepts a bigint id identically to its decimal string', () => {
        const snowflake = 1234567890123456789n

        expect(segmentsOf(withValue(snowflake).pathname)).toEqual(
          segmentsOf(withValue(snowflake.toString()).pathname)
        )
      })

      /**
       * The URL is not the only builder that touches an id. `create_thread` also
       * reads `messageId` in its `body` to decide the thread type, and a
       * `?.trim()` there threw a bare TypeError on a numeric id *after* the URL
       * had already accepted it — caught by review, not by this suite, because
       * the suite only ever exercised `request.url`.
       */
      it('builds body and headers from a numeric id without a TypeError', () => {
        const numericParams = buildParams(tool, { ...overrides, [param]: 8035111022467891 })

        expect(throwsTypeError(() => tool.request.url(numericParams))).toBe(false)
        expect(throwsTypeError(() => tool.request.body?.(numericParams))).toBe(false)
        expect(throwsTypeError(() => tool.request.headers?.(numericParams))).toBe(false)
      })

      it('trims surrounding whitespace off a legitimate value', () => {
        const actual = segmentsOf(withValue(`  ${TRIM_SAMPLE}  `).pathname)

        baseline.forEach((segment, index) => {
          expect(actual[index]).toBe(segment.replaceAll(PROBE, TRIM_SAMPLE))
        })
      })
    }
  )
})

/**
 * Pins the reason `MUST_REJECT` asserts a throw rather than comparing shape.
 *
 * `messageId` is the final segment of `DELETE /channels/{id}/messages/{id}`, so
 * a bare `.` there deletes nothing and instead addresses the *collection* —
 * while leaving the segment count and every other segment identical. A
 * shape-only assertion cannot see it. If this test ever starts failing because
 * the path stopped ending in the id, the reasoning above needs revisiting.
 */
describe('a trailing dot segment is invisible to a shape check', () => {
  const tool = pathToolFor(discordDeleteMessageTool, 'discord_delete_message')

  it('collapses to the parent collection without changing the segment count', () => {
    const baseline = segmentsOf(
      new URL('https://discord.com/api/v10/channels/123/messages/SAFEID').pathname
    )
    const collapsed = segmentsOf(
      new URL(`https://discord.com/api/v10/channels/123/messages/${encodeURIComponent('.')}`)
        .pathname
    )

    expect(collapsed).toHaveLength(baseline.length)
    expect(collapsed.at(-1)).toBe('')
  })

  it('is caught anyway, because the guard rejects rather than encodes', () => {
    expect(() => buildUrl(tool, { messageId: '.' })).toThrow(/path traversal is not allowed/)
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
  const getMember = pathToolFor(discordGetMemberTool, 'discord_get_member')
  const assignRole = pathToolFor(discordAssignRoleTool, 'discord_assign_role')

  it('accepts a numeric id inside the safe integer range', () => {
    const url = new URL(
      getMember.request.url({
        botToken: 'bot-token',
        serverId: 8035111022467891,
        userId: 8035111022467892,
      })
    )

    expect(url.pathname).toBe('/api/v10/guilds/8035111022467891/members/8035111022467892')
  })

  it('accepts a full-width snowflake supplied as a bigint', () => {
    const url = new URL(
      getMember.request.url({
        botToken: 'bot-token',
        serverId: 1234567890123456789n,
        userId: 987654321098765432n,
      })
    )

    expect(url.pathname).toBe('/api/v10/guilds/1234567890123456789/members/987654321098765432')
  })

  it('refuses a snowflake JSON.parse already rounded rather than addressing the wrong resource', () => {
    const roundedSnowflake = Number('1234567890123456789')

    expect(roundedSnowflake).not.toBe(1234567890123456789n)

    expect(() =>
      assignRole.request.url({
        botToken: 'bot-token',
        serverId: roundedSnowflake,
        userId: '123456789012345678',
        roleId: '123456789012345678',
      })
    ).toThrow(/serverId is too large to be represented exactly/)
  })
})
