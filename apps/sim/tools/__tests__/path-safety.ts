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
 * **Branches.** A parameter that only reaches the path on one branch of a
 * conditional builder is invisible to a single-shot probe. Discovery therefore
 * reads the literals the builder compares against out of its own source and
 * probes each one, and each **pair** of them — a parameter can sit behind two
 * simultaneous conditions. The depth stops at two rather than being exhaustive;
 * `siblingAssignments` says so where the bound is set.
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
  /**
   * A **balanced** traversal: it pops exactly as many segments as it adds, so
   * the resolved path keeps the baseline's segment count and only the guarded
   * slot's neighbourhood changes. A count-only shape check cannot see it, which
   * is why every value here is asserted to throw instead.
   */
  'id/../../other/victim',
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

/**
 * A declared parameter whose probe threw on **every** branch, so discovery
 * never learned whether it reaches the path.
 *
 * This is distinct from a parameter that simply is not in the path: those build
 * a URL fine, the sentinel just does not appear in it. Here nothing was built
 * at all, so the parameter drops out of coverage with no assertion behind it —
 * and unlike an unbuildable *tool*, its siblings keep the tool itself covered,
 * so nothing else notices. Each suite pins this set, which is what turns a
 * silent disappearance into a failure.
 */
export interface UndiscoverableParam {
  label: string
  reason: string
}

const SAFE_ID = 'SAFEID'

/** Sentinel for the one parameter under test, so its slots are identifiable. */
const PROBE_ID = 'PROBEID'

/** Not a declared parameter — leaves every real one at its safe value. */
const ALL_SAFE = '__all_safe__'

/**
 * Ceiling on probe assignments per tool, so pair-probing cannot turn a tool
 * with many parameters and many branch literals into a combinatorial blowup.
 */
const MAX_BRANCH_ASSIGNMENTS = 600

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
 * The sibling assignments to probe: the plain one, then each parameter pinned
 * to each branch literal, then every **pair** of those pinnings on distinct
 * parameters.
 *
 * Pairs are not decoration. A parameter can sit behind two simultaneous
 * conditions — `action === 'unblock' && type === 'folder'` — and a probe that
 * only ever pins one sibling at a time never reaches it, so the parameter is
 * invisible to discovery and silently untested. Single-pinning alone would make
 * "every branch is probed" an overclaim.
 *
 * The depth stops at two, and that bound is honest rather than exhaustive:
 * three simultaneous conditions would still be missed. Going deeper is
 * combinatorial in the number of (parameter, literal) pinnings, so the count is
 * also capped — beyond {@link MAX_BRANCH_ASSIGNMENTS} the pairs are dropped and
 * the single pinnings are kept, since those cover strictly more builders per
 * probe. No service currently needs even one literal to reach any parameter, so
 * this is machinery for the builders that come later rather than for today's.
 */
function siblingAssignments(names: string[], literals: string[]): Record<string, unknown>[] {
  const singles: Record<string, unknown>[] = []
  for (const literal of literals) {
    for (const name of names) singles.push({ [name]: literal })
  }

  /**
   * The ceiling is checked against the projected count *before* the pairs are
   * built, so a tool with many parameters and many literals does not allocate
   * tens of thousands of objects only to discard them.
   */
  const projected = 1 + singles.length + (singles.length * (singles.length - 1)) / 2
  if (projected > MAX_BRANCH_ASSIGNMENTS) return [{}, ...singles]

  const pairs: Record<string, unknown>[] = []
  for (let i = 0; i < singles.length; i++) {
    const [nameA] = Object.keys(singles[i])
    for (let j = i + 1; j < singles.length; j++) {
      const [nameB] = Object.keys(singles[j])
      if (nameA === nameB) continue
      pairs.push({ ...singles[i], ...singles[j] })
    }
  }

  return [{}, ...singles, ...pairs]
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
): {
  covered: PathParam[]
  unbuildable: UnbuildableTool[]
  undiscoverable: UndiscoverableParam[]
} {
  const covered: PathParam[] = []
  const unbuildable: UnbuildableTool[] = []
  const undiscoverable: UndiscoverableParam[] = []

  for (const exported of Object.values(barrel)) {
    const tool = asPathTool(exported)
    if (!tool || !tool.id.startsWith(idPrefix)) continue

    const names = Object.keys(tool.params ?? {}).filter((name) => !(name in fixed))

    const branches = siblingAssignments(names, branchLiterals(tool))

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
      let builtOnce = false
      let probeFailure = ''

      for (const branch of branches) {
        if (name in branch) continue
        const context = { ...fixed, ...branch }
        try {
          const { pathname } = buildUrl(tool, name, PROBE_ID, context)
          builtOnce = true
          if (pathname.includes(PROBE_ID)) {
            match = context
            break
          }
        } catch (error) {
          // A guarded parameter is expected to throw for some probes; another
          // branch may still reach it, so keep going and record why in case
          // none of them do.
          if (!probeFailure) probeFailure = getErrorMessage(error, 'unknown error')
        }
      }

      if (match) {
        covered.push({ label: `${tool.id} :: ${name}`, tool, paramName: name, context: match })
        continue
      }

      /**
       * Only a parameter that never produced a URL at all is reported. One that
       * built fine but kept the sentinel out of `pathname` is simply not a path
       * parameter, which is a legitimate and common outcome.
       */
      if (!builtOnce) {
        undiscoverable.push({
          label: `${tool.id} :: ${name}`,
          reason: probeFailure || 'probe produced no URL',
        })
      }
    }
  }

  return { covered, unbuildable, undiscoverable }
}

/**
 * Lists every tool of a service that contributes **no** (tool, parameter) pair.
 *
 * Each suite pins this set exactly, so a tool cannot leave path coverage
 * unnoticed: if one ever gains a guarded path parameter it becomes a covered
 * pair, the set shrinks, and the assertion fails until someone looks.
 *
 * The enumeration is deliberately **looser** than {@link discoverPathParams}.
 * That function can only drive a tool whose `request.url` is a function, since
 * it has to call it. Filtering the inventory the same way would make three
 * whole categories invisible to *both* sides and let the pin pass vacuously —
 * which is exactly what happened before: `box_create_folder` declares
 * `url` as a plain **string**, and `box_upload_file` is an `InternalToolConfig`
 * with no `request` at all, so neither appeared in the covered pairs *or* in
 * the pinned set, and `toEqual(['box_search'])` passed precisely because they
 * could not be seen. Eleven tools across four services were invisible that way.
 *
 * So this walks every export whose `id` carries the service prefix, whatever
 * shape its request takes, and reports the ones no pair covers. The pinned list
 * then states the real inventory, and each entry has to be justified as one of:
 *
 * - a genuinely static or query-string-only URL (`box_search`);
 * - a `url` declared as a constant string (`box_create_folder`);
 * - an `InternalToolConfig` whose URL is built in `lib/internal/**`
 *   (`supabase_storage_upload`). **These are outside what this suite can
 *   reach**, and are covered instead by direct unit tests on the helper they
 *   use — see the `encodeStoragePath` / `encodeStorageSegment` describes in
 *   `supabase/path_safety.test.ts`.
 */
export function toolsWithoutPathParams(
  barrel: Record<string, unknown>,
  idPrefix: string,
  fixed: Record<string, unknown> = {}
): string[] {
  const { covered } = discoverPathParams(barrel, idPrefix, fixed)
  const withParams = new Set(covered.map(({ tool }) => tool.id))

  return Object.values(barrel)
    .map((value) => (value as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.startsWith(idPrefix))
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
  /**
   * Parameter names that must **refuse** a padded value rather than trim it.
   *
   * Trimming is not neutral on a parameter that was not trimmed before: a
   * padded id previously named nothing and the request failed, so trimming
   * silently resolves it to a real resource. On an irreversible operation that
   * turns a no-op into a deletion. Naming those parameters here upgrades the
   * whitespace assertion from "same path or no path" to "must throw", so the
   * rejection cannot quietly regress into a trim.
   */
  rejectsSurroundingWhitespace?: readonly string[]
  /**
   * Parameters guarded by a stricter, service-specific validator that predates
   * these path guards — Supabase's `table` and `column` go through
   * `validateDatabaseIdentifier`, `functionName` through `validateFunctionName`.
   *
   * Those legitimately refuse values the shared guards merely render inert
   * (`abc#fragment` is a fine URL segment but not a SQL identifier), so a throw
   * from them is a correct outcome. Everywhere else a throw is a **failure**:
   * `MUST_NOT_RESHAPE` values must actually reach the wire encoded, and a guard
   * that over-tightens and rejects one is a regression the suite has to catch.
   * Listing the exceptions by name is what keeps "tolerated" from silently
   * becoming "untested".
   */
  strictlyValidated?: readonly string[]
}

/** Asserts the traversal invariant for one (tool, parameter) pair. */
export function itResistsTraversal(
  { tool, paramName, context }: PathParam,
  {
    origin,
    basePath,
    preservesWhitespace = false,
    rejectsSurroundingWhitespace = [],
    strictlyValidated = [],
  }: TraversalOptions
): void {
  const baselinePath = buildUrl(tool, paramName, PROBE_ID, context).pathname
  const baselineSegments = baselinePath.split('/')
  const probeIndex = baselineSegments.indexOf(PROBE_ID)
  const prefix = baselineSegments.slice(0, probeIndex)

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
    } catch (error) {
      /**
       * A throw here is only acceptable from a parameter with a stricter
       * pre-existing validator. Otherwise the value was supposed to survive
       * encoded, and swallowing the rejection would hide a guard that has
       * over-tightened — the suite would then prove only that values which
       * *build* stay inert, which is not the property claimed.
       */
      expect(
        strictlyValidated.includes(paramName),
        `${paramName} rejected ${JSON.stringify(value)}, which must be rendered inert: ${getErrorMessage(error, 'unknown error')}`
      ).toBe(true)
      return
    }

    expect(url.origin).toBe(origin)
    expect(url.pathname.startsWith(basePath)).toBe(true)

    const segments = url.pathname.split('/')
    expect(segments).not.toContain('..')
    expect(segments).not.toContain('.')
    expect(url.searchParams.get('injectedProbe')).toBeNull()

    if (preservesWhitespace) {
      /**
       * A hierarchical value legitimately changes the segment count, so only
       * the fixed prefix ahead of it can be pinned.
       */
      expect(segments.slice(0, prefix.length)).toEqual(prefix)
      return
    }

    /**
     * A single-segment guard must always yield exactly one segment, so the
     * whole shape is pinned — count included, and every slot but the guarded
     * one compared against the baseline. Checking only the prefix would let a
     * value that expands its own slot (`a/b/../c`) through unnoticed.
     */
    expect(segments).toHaveLength(baselineSegments.length)
    segments.forEach((segment, index) => {
      if (index === probeIndex) return
      expect(segment).toBe(baselineSegments[index])
    })
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

    if (rejectsSurroundingWhitespace.includes(paramName)) {
      let message = ''
      try {
        buildUrl(tool, paramName, padded, context)
      } catch (error) {
        message = getErrorMessage(error, 'unknown error')
      }

      expect(message, `${paramName} accepted a padded value instead of refusing it`).not.toBe('')
      expect(namesParam(message, paramName), `error did not name ${paramName}: ${message}`).toBe(
        true
      )
      return
    }

    if (preservesWhitespace) {
      /**
       * No tolerance for a throw here. This branch asserts that padding
       * *survives*, so a rejection contradicts it outright — swallowing that
       * would let `safeUrlPath` regress to trimming or refusing while the suite
       * stayed green, which is the failure mode this file exists to prevent.
       */
      const url = buildUrl(tool, paramName, padded, context)

      expect(url.pathname.startsWith(basePath)).toBe(true)
      expect(decodeURIComponent(url.pathname)).toBe(
        decodeURIComponent(baselinePath).split(PROBE_ID).join(padded)
      )
      return
    }

    /**
     * For an ordinary id, refusing padding outright is an equally correct
     * outcome — `validateDatabaseIdentifier` guards Supabase's `table` and
     * admits no whitespace at all — so the assertion is "same path or no path".
     */
    let url: URL
    try {
      url = buildUrl(tool, paramName, padded, context)
    } catch (error) {
      expect(
        strictlyValidated.includes(paramName),
        `${paramName} rejected a padded value without being a strictly-validated parameter: ${getErrorMessage(error, 'unknown error')}`
      ).toBe(true)
      return
    }

    expect(url.pathname).toBe(baselinePath)
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
