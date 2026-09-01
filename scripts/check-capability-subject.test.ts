import { describe, expect, it } from 'vitest'
import { auditMiddlewareExport, auditSource } from './check-capability-subject'

const ROUTE = 'apps/sim/app/api/v1/tables/route.ts'
const MIDDLEWARE = 'apps/sim/app/api/v1/middleware.ts'

describe('assertion B — a v1 route may not decide a capability for itself', () => {
  /**
   * The user-global resolver takes a bare `userId` and falls back to the
   * organization's default group, so a route reaching for it is one property
   * access away from `rateLimit.userId` — the key's creator. It was absent from
   * the module list, which is exactly the shape of gap that passes in silence.
   */
  it('reports a route that imports the user-global resolver directly', () => {
    const { findings } = auditSource(
      ROUTE,
      "import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'\n"
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('user-scope.server')
  })

  it.each([
    '@/lib/permission-groups/capability-assertions',
    '@/lib/permission-groups/capabilities',
    '@/lib/permission-groups/resolve.server',
    '@/lib/permission-groups/config-scope.server',
    '@/lib/permission-groups/user-scope.server',
  ])('reports a route that imports %s', (module) => {
    const { findings } = auditSource(ROUTE, `import { thing } from '${module}'\n`)

    expect(findings).toHaveLength(1)
  })

  it('allows the middleware itself, which is where the decision belongs', () => {
    const { findings } = auditSource(
      MIDDLEWARE,
      "import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'\n"
    )

    expect(findings).toEqual([])
  })
})

describe('assertion C — the subject came from capabilityGovernedUserId', () => {
  it('accepts a subject bound to the governed id', () => {
    const { findings, sinks } = auditSource(
      MIDDLEWARE,
      [
        'const governedUserId = capabilityGovernedUserId(rateLimit)',
        "await isWorkspaceCapabilityWithheld(governedUserId, workspaceId, 'personal_api_key.use')",
      ].join('\n')
    )

    expect(findings).toEqual([])
    expect(sinks).toBe(1)
  })

  it('reports the key creator read straight off the rate-limit result', () => {
    const { findings, sinks } = auditSource(
      MIDDLEWARE,
      "await isWorkspaceCapabilityWithheld(rateLimit.userId, workspaceId, 'personal_api_key.use')\n"
    )

    expect(sinks).toBe(0)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('rateLimit.userId')
  })
})

describe('assertion C — the two renames that made it a no-op', () => {
  /**
   * The alias leaves the sink's own name on the import line and nowhere else,
   * so the audit read a file full of ungoverned calls as a file with none.
   */
  it('follows an import alias to the call it renamed', () => {
    const { findings, sinks } = auditSource(
      MIDDLEWARE,
      [
        "import { assertWorkspaceCapability as assertCap } from '@/lib/permission-groups/capability-assertions'",
        "await assertCap(rateLimit.userId, workspaceId, 'tables.use')",
      ].join('\n')
    )

    expect(sinks).toBe(0)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('rateLimit.userId')
  })

  it('accepts an aliased call whose subject is still governed', () => {
    const { findings, sinks } = auditSource(
      'apps/sim/app/api/v1/logs/route.ts',
      [
        'import { resolveLogFieldProjection as project } from "@/lib/logs/log-projection"',
        'const governed = capabilityGovernedUserId(rateLimit)',
        'await project(governed, workspaceId)',
      ].join('\n')
    )

    expect(findings).toEqual([])
    expect(sinks).toBe(1)
  })

  it('refuses a route that declares the governed-subject name for itself', () => {
    const { findings } = auditSource(
      'apps/sim/app/api/v1/logs/route.ts',
      [
        'function capabilityGovernedUserId(rateLimit) { return rateLimit.userId }',
        "await isWorkspaceCapabilityWithheld(capabilityGovernedUserId(rateLimit), ws, 'tables.use')",
      ].join('\n')
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('shadowing')
  })
})

describe('assertion A — the name the audit is written in terms of', () => {
  it('reports a middleware that no longer exports it', () => {
    expect(auditMiddlewareExport('export function someOtherName() {}')).toHaveLength(1)
  })

  it('accepts a middleware that still does', () => {
    expect(
      auditMiddlewareExport('export function capabilityGovernedUserId(rateLimit) { return null }')
    ).toEqual([])
  })
})

describe('assertion C — a fallback welded to the governed subject', () => {
  /**
   * The verified evasion. `capabilityGovernedUserId(rateLimit) ?? …` is what a
   * reviewer writes when the governed subject's `null` reads as a gap rather
   * than an answer: it satisfies the prefix match, it reintroduces the
   * key-creator substitution verbatim, and before this assertion it INCREMENTED
   * the liveness counter — the audit reported itself more alive for the evasion.
   */
  it('reports a nullish fallback on an inline governed call, and does not count it', () => {
    const { findings, sinks } = auditSource(
      ROUTE,
      'const withheld = await isWorkspaceCapabilityWithheld(\n' +
        '  capabilityGovernedUserId(rateLimit) ?? requireRateLimitUserId(rateLimit),\n' +
        "  workspaceId,\n  'tables.use'\n)\n"
    )

    expect(sinks).toBe(0)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('falls back when')
  })

  it('reports a logical-or fallback the same way', () => {
    const { findings, sinks } = auditSource(
      ROUTE,
      "const withheld = await isWorkspaceCapabilityWithheld(capabilityGovernedUserId(rateLimit) || rateLimit.userId, workspaceId, 'tables.use')\n"
    )

    expect(sinks).toBe(0)
    expect(findings).toHaveLength(1)
  })

  /**
   * The bound-local form of the same evasion. The local is refused rather than
   * registered: registering it would make every sink taking it read as governed.
   */
  it('reports a fallback on the binding, and refuses the local it binds', () => {
    const { findings, sinks } = auditSource(
      ROUTE,
      'const subject = capabilityGovernedUserId(rateLimit) ?? rateLimit.userId\n' +
        "await assertWorkspaceCapability(subject, workspaceId, 'tables.use')\n"
    )

    expect(sinks).toBe(0)
    expect(findings).toHaveLength(2)
    expect(findings[0].message).toContain('falls back when')
    expect(findings[1].message).toContain('did not come from')
  })

  it('leaves an un-welded governed call alone, inline and through a local', () => {
    const { findings, sinks } = auditSource(
      ROUTE,
      'const subject = capabilityGovernedUserId(rateLimit)\n' +
        "await assertWorkspaceCapability(subject, workspaceId, 'tables.use')\n" +
        "await isWorkspaceCapabilityWithheld(capabilityGovernedUserId(rateLimit), workspaceId, 'tables.use')\n"
    )

    expect(findings).toEqual([])
    expect(sinks).toBe(2)
  })

  /**
   * A `??` inside a nested argument list is not a fallback applied to the
   * subject, so the depth tracking has to survive one.
   */
  it('does not mistake a nested ?? inside the governed call for a fallback', () => {
    const { findings, sinks } = auditSource(
      ROUTE,
      "await isWorkspaceCapabilityWithheld(capabilityGovernedUserId(rateLimit ?? auth), workspaceId, 'tables.use')\n"
    )

    expect(findings).toEqual([])
    expect(sinks).toBe(1)
  })
})
