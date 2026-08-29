/**
 * Shared harness for the per-service `path_safety.test.ts` suites.
 *
 * Each suite enumerates its service's **(tool, parameter) pairs** from the
 * barrel rather than listing them by hand, so a newly added tool — or a new id
 * parameter on an existing tool — is covered without anyone remembering to
 * register it.
 *
 * Three details are load-bearing, and each exists because an earlier version of
 * this harness got it wrong.
 *
 * **One parameter at a time.** The first version filled *every* string
 * parameter with the same hostile value and swallowed the throw, so the moment
 * one parameter was guarded its siblings stopped being exercised: reverting the
 * guard on `google_drive_unshare`'s `permissionId` while its sibling `fileId`
 * stayed guarded left the suite reporting 285/285 green. Each pair is therefore
 * driven on its own, with every sibling held at a safe value.
 *
 * **Rejection, not shape.** A shape-only assertion is blind to a dot segment in
 * the *final* position: `https://x/a/.` normalizes to `https://x/a/`, which
 * preserves the segment count and every other segment, so the check passes with
 * the guard removed. Tools whose path ends in the guarded id — the Drive
 * `delete_*` family, `box_sign_get_request` — are exactly where that blind spot
 * lives, so every value in {@link MUST_REJECT} is asserted to *throw*.
 *
 * **Every branch.** A parameter that only reaches the path on one branch of a
 * conditional builder is invisible to a single-shot probe. Discovery therefore
 * reads the literals the builder compares against out of its own source and
 * probes each one.
 *
 * Every assertion resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — instead of string-matching the template
 * output. String matching is exactly what let dot-segment traversal through:
 * the template looks correct and the parser rewrites it afterwards.
 */
import { getErrorMessage } from '@sim/utils/errors'
import { expect, it } from 'vitest'

/**
 * The structural shape this harness needs from a tool.
 *
 * Declared locally rather than as `ToolConfig<any, any>` so the harness carries
 * no `any`: the barrels export tools over many different parameter types, and
 * nothing here needs to know any of them beyond "there are declared params and
 * a URL builder".
 */
export interface PathTool {
  id: string
  params?: Record<string, { type?: string } | undefined>
  buildUrl: (params: Record<string, unknown>) => string
}

/** Narrows an unknown barrel export to the shape this harness can drive. */
function asPathTool(value: unknown): PathTool | undefined {
  if (typeof value !== 'object' || value === null) return undefined

  const candidate = value as {
    id?: unknown
    params?: Record<string, { type?: string } | undefined>
    request?: { url?: unknown }
  }

  if (typeof candidate.id !== 'string' || typeof candidate.request?.url !== 'function') {
    return undefined
  }

  return {
    id: candidate.id,
    params: candidate.params,
    buildUrl: candidate.request.url as (params: Record<string, unknown>) => string,
  }
}

/**
 * A dot segment wrapped in padding.
 *
 * Whether this must be rejected depends on which guard is in play, which is why
 * it is named: `safeUrlPathSegment` trims first and rejects it, because
 * whitespace around an *id* is copy-paste noise. `safeUrlPath` does not trim at
 * all since #7262's whitespace fix, so it emits `%20%20..%20%20` — one ordinary
 * segment that the URL parser does **not** treat as a dot segment, addressing
 * an object literally named `"  ..  "`. Both are correct for their purpose.
 */
const PADDED_DOT_SEGMENT = '  ..  '

/**
 * Values that no guard may ever accept, because each one either *is* a dot
 * segment or contains one, and no encoding neutralizes that — the URL parser
 * removes it after decoding.
 *
 * These are asserted to throw. A shape check alone cannot see them when the
 * parameter sits in the final path position.
 */
export const MUST_REJECT = [
  '..',
  '.',
  PADDED_DOT_SEGMENT,
  '../',
  './',
  '../../about',
  'abc/../../../drives',
  'abc/items/../../../v2/other',
  '\\..\\..',
] as const

/**
 * Values a guard may legitimately *accept* — percent-encoding renders them
 * inert — but which must never restructure the resolved URL. `%2f` is not
 * decoded before dot segments are removed, and `?`/`#` are escaped, so these
 * survive as opaque text inside one segment.
 */
export const MUST_NOT_RESHAPE = [
  '..%2f..%2fabout',
  'abc?injectedProbe=attacker',
  'abc#fragment',
] as const

/** A single parameter of a single tool that reaches a URL path segment. */
export interface PathParam {
  label: string
  tool: PathTool
  paramName: string
  /**
   * The sibling values that make this parameter reach the path — the service's
   * fixed params plus, where the builder branches, the literal that selects the
   * branch the parameter lives on.
   */
  context: Record<string, unknown>
}

/** A tool whose URL will not build even from all-safe values. */
export interface UnbuildableTool {
  id: string
  reason: string
}

const SAFE_ID = 'SAFEID'

/** Sentinel for the one parameter under test, so its slots are identifiable. */
const PROBE_ID = 'PROBEID'

/** Not a declared parameter — leaves every real one at its safe value. */
const ALL_SAFE = '__all_safe__'

/**
 * Fills every declared parameter with a type-appropriate safe value, then
 * overrides the single parameter under test.
 */
function buildParams(
  tool: PathTool,
  paramName: string,
  value: string,
  fixed: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    const type = def?.type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = SAFE_ID
    }
  }
  Object.assign(params, fixed)
  params[paramName] = value
  return params
}

function buildUrl(
  tool: PathTool,
  paramName: string,
  value: string,
  fixed: Record<string, unknown>
): URL {
  return new URL(tool.buildUrl(buildParams(tool, paramName, value, fixed)))
}

/**
 * Harvests the string literals a URL builder compares against, straight from
 * its own source.
 *
 * Some builders put a path parameter on only one branch of a conditional — a
 * second identifier that appears only when `action === 'unblock'`, say — and
 * the discriminating parameter often declares no enum, only prose in its
 * description. Probing with a single default value never enters that branch, so
 * the parameter is invisible to discovery and silently untested.
 *
 * Reading the comparands out of the function source means every branch is
 * probed, and a branch added later is picked up without editing any test.
 */
function branchLiterals(tool: PathTool): string[] {
  const source = String(tool.buildUrl)
  const literals = new Set<string>()

  for (const pattern of [
    /[=!]==\s*['"`]([^'"`\n]{1,64})['"`]/g,
    /['"`]([^'"`\n]{1,64})['"`]\s*[=!]==/g,
    /case\s+['"`]([^'"`\n]{1,64})['"`]/g,
  ]) {
    for (const match of source.matchAll(pattern)) literals.add(match[1])
  }

  return [...literals]
}

/**
 * Enumerates every (tool, parameter) pair of a service whose value lands in a
 * URL **path** segment.
 *
 * A parameter that only ever reaches the query string, or a tool with a static
 * URL, is not in this risk class and is left out — the probe decides that by
 * looking for the sentinel in `pathname`, never in the full URL.
 */
export function discoverPathParams(
  barrel: Record<string, unknown>,
  idPrefix: string,
  fixed: Record<string, unknown> = {}
): { covered: PathParam[]; unbuildable: UnbuildableTool[] } {
  const covered: PathParam[] = []
  const unbuildable: UnbuildableTool[] = []

  for (const exported of Object.values(barrel)) {
    const tool = asPathTool(exported)
    if (!tool || !tool.id.startsWith(idPrefix)) continue

    const names = Object.keys(tool.params ?? {}).filter((name) => !(name in fixed))

    /**
     * Every sibling assignment worth probing: the plain one, then each
     * parameter pinned to each literal the builder branches on.
     */
    const branches: Record<string, unknown>[] = [{}]
    for (const literal of branchLiterals(tool)) {
      for (const name of names) branches.push({ [name]: literal })
    }

    /**
     * Buildability is decided from an all-safe build, independent of the
     * per-parameter probes. A probe is *meant* to throw for a guarded
     * parameter, so treating a failed probe as an unbuildable tool would make
     * this list noisy; but a tool whose URL will not build at all must never
     * vanish from coverage silently.
     */
    let buildable = false
    let firstFailure = ''
    for (const branch of branches) {
      try {
        buildUrl(tool, ALL_SAFE, SAFE_ID, { ...fixed, ...branch })
        buildable = true
        break
      } catch (error) {
        if (!firstFailure) firstFailure = getErrorMessage(error, 'unknown error')
      }
    }

    if (!buildable) unbuildable.push({ id: tool.id, reason: firstFailure || 'URL did not build' })

    for (const name of names) {
      let match: Record<string, unknown> | undefined

      for (const branch of branches) {
        if (name in branch) continue
        const context = { ...fixed, ...branch }
        try {
          if (buildUrl(tool, name, PROBE_ID, context).pathname.includes(PROBE_ID)) {
            match = context
            break
          }
        } catch {
          // A guarded parameter is expected to throw for some probes; another
          // branch may still reach it, so keep going.
        }
      }

      if (match) {
        covered.push({ label: `${tool.id} :: ${name}`, tool, paramName: name, context: match })
      }
    }
  }

  return { covered, unbuildable }
}

/**
 * Lists the service's tools that contribute **no** (tool, parameter) pair.
 *
 * Each suite pins this set exactly. A tool belongs here only if its URL is
 * genuinely static or purely query-string driven; if one ever appears because a
 * sibling parameter threw before the real ones could be probed, the tool has
 * silently left coverage entirely, and a case that is never generated can never
 * fail. Pinning the set turns that from invisible into a failing assertion.
 *
 * Sibling parameters are filled from their declared `type` — `1` for `number`,
 * `false` for `boolean`, `[]` for `json`/`array` — precisely so an early
 * type check on a sibling cannot be what removes a tool from the suite.
 */
export function toolsWithoutPathParams(
  barrel: Record<string, unknown>,
  idPrefix: string,
  fixed: Record<string, unknown> = {}
): string[] {
  const { covered } = discoverPathParams(barrel, idPrefix, fixed)
  const withParams = new Set(covered.map(({ tool }) => tool.id))

  return Object.values(barrel)
    .map(asPathTool)
    .filter((tool): tool is PathTool => tool?.id.startsWith(idPrefix))
    .map(({ id }) => id)
    .filter((id) => !withParams.has(id))
    .sort()
}

/**
 * Normalizes an error message and a parameter name to bare lowercase letters so
 * a guard can be credited with naming its parameter however it spells it.
 *
 * A few parameters are refused by a stricter service-specific validator that
 * predates these guards and spells the name in prose — Supabase's
 * `functionName` is reported as *"Invalid function name"*. That is an equally
 * correct outcome and should still count as naming the offender, so both sides
 * are stripped of non-letters before the comparison.
 */
function namesParam(message: string, paramName: string): boolean {
  const strip = (text: string) => text.toLowerCase().replaceAll(/[^a-z]/g, '')
  return strip(message).includes(strip(paramName))
}

export interface TraversalOptions {
  origin: string
  /** The fixed API prefix every route of the service shares. */
  basePath: string
  /**
   * Set for a genuinely hierarchical parameter — a Supabase storage object key,
   * a People API `resourceName` — which is guarded by `safeUrlPath`.
   *
   * Since #7262's whitespace fix that helper treats whitespace as **data**, not
   * noise: a leading or trailing space is a legal filename character, and
   * trimming it addresses a different object than the caller named. So padding
   * is preserved rather than stripped, and {@link PADDED_DOT_SEGMENT} becomes a
   * value to render inert rather than one to reject. Leave unset for ordinary
   * ids, where `safeUrlPathSegment` trims and rejects.
   */
  preservesWhitespace?: boolean
}

/** Asserts the traversal invariant for one (tool, parameter) pair. */
export function itResistsTraversal(
  { tool, paramName, context }: PathParam,
  { origin, basePath, preservesWhitespace = false }: TraversalOptions
): void {
  const baselinePath = buildUrl(tool, paramName, PROBE_ID, context).pathname
  const prefix = baselinePath.split('/').slice(0, baselinePath.split('/').indexOf(PROBE_ID))

  const mustReject = preservesWhitespace
    ? MUST_REJECT.filter((value) => value !== PADDED_DOT_SEGMENT)
    : MUST_REJECT
  const mustNotReshape = preservesWhitespace
    ? [...MUST_NOT_RESHAPE, PADDED_DOT_SEGMENT]
    : MUST_NOT_RESHAPE

  it('stays under the service API prefix', () => {
    expect(baselinePath.startsWith(basePath)).toBe(true)
  })

  /**
   * The rejection assertion, not a shape assertion. A trailing `.` preserves
   * the shape of the resolved path exactly, so only "did it throw" can see it.
   */
  it.each(mustReject)('rejects %j outright, naming the parameter', (value) => {
    let message = ''
    try {
      buildUrl(tool, paramName, value, context)
    } catch (error) {
      message = getErrorMessage(error, 'unknown error')
    }

    expect(message, `${paramName} accepted ${JSON.stringify(value)}`).not.toBe('')
    expect(namesParam(message, paramName), `error did not name ${paramName}: ${message}`).toBe(true)
  })

  it.each(mustNotReshape)('renders %j inert without reshaping the path', (value) => {
    let url: URL
    try {
      url = buildUrl(tool, paramName, value, context)
    } catch {
      return
    }

    expect(url.origin).toBe(origin)
    expect(url.pathname.startsWith(basePath)).toBe(true)

    const segments = url.pathname.split('/')
    expect(segments.slice(0, prefix.length)).toEqual(prefix)
    expect(segments).not.toContain('..')
    expect(segments).not.toContain('.')
    expect(url.searchParams.get('injectedProbe')).toBeNull()
  })

  /**
   * What padding may do depends on what the parameter *is*.
   *
   * For an id it is copy-paste noise, so it must not change which resource is
   * addressed; refusing it outright is equally correct, since
   * `validateDatabaseIdentifier` guards Supabase's `table` and admits no
   * whitespace at all. The assertion is therefore "same path or no path".
   *
   * For a hierarchical key it is data — `"  file.png"` and `"file.png"` are
   * different objects — so the assertion inverts: the padding must survive to
   * the wire, encoded, and must still resolve inside the API prefix.
   */
  it('handles surrounding whitespace according to the parameter kind', () => {
    const padded = `  ${PROBE_ID}  `
    let url: URL
    try {
      url = buildUrl(tool, paramName, padded, context)
    } catch {
      return
    }

    if (!preservesWhitespace) {
      expect(url.pathname).toBe(baselinePath)
      return
    }

    expect(url.pathname.startsWith(basePath)).toBe(true)
    expect(decodeURIComponent(url.pathname)).toBe(
      decodeURIComponent(baselinePath).split(PROBE_ID).join(padded)
    )
  })
}

/**
 * Asserts that real-world values reach the wire byte-for-byte, so a guard can
 * never be tightened into breaking legitimate callers.
 */
export function itPassesLegitimateValues(
  { tool, paramName, context }: PathParam,
  { values, fixed = {} }: { values: readonly string[]; fixed?: Record<string, unknown> }
): void {
  const merged = { ...context, ...fixed }
  const baseline = buildUrl(tool, paramName, PROBE_ID, merged).pathname

  it.each(values)('passes %j through unchanged', (value) => {
    expect(decodeURIComponent(buildUrl(tool, paramName, value, merged).pathname)).toBe(
      decodeURIComponent(baseline).split(PROBE_ID).join(value)
    )
  })
}
