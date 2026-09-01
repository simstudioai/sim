import { describe, expect, it } from 'vitest'
import {
  deferredSpecifiers,
  FORBIDDEN_PREFIXES,
  findViolations,
  GUARDED_ROOTS,
  resolveSpecifier,
  runtimeSpecifiers,
} from './check-application-graph'

describe('runtimeSpecifiers', () => {
  it('collects import and re-export specifiers', () => {
    expect(
      runtimeSpecifiers(
        "import { a } from '@/lib/a'\nexport { b } from '@/lib/b'\nimport '@/lib/c'\n"
      )
    ).toEqual(['@/lib/a', '@/lib/b', '@/lib/c'])
  })

  /**
   * The heaviest edge of all — the module is loaded purely to run — and the one
   * nothing in the importing file names, so it was walked straight past.
   */
  it('collects a side-effect import, in source order', () => {
    expect(
      runtimeSpecifiers("import '@/lib/uploads/core/setup.server'\nimport { a } from '@/lib/a'\n")
    ).toEqual(['@/lib/uploads/core/setup.server', '@/lib/a'])
  })

  it('leaves a dynamic import out of the module-evaluation set', () => {
    expect(runtimeSpecifiers("const a = await import('@/lib/a')\n")).toEqual([])
  })

  it('ignores type-only statements, which the compiler erases', () => {
    expect(
      runtimeSpecifiers(
        "import type { A } from '@/lib/a'\nimport type B from '@/lib/b'\nexport type { C } from '@/lib/c'\n"
      )
    ).toEqual([])
  })

  it('keeps an inline type import, which still emits a runtime load', () => {
    expect(runtimeSpecifiers("import { type A, b } from '@/lib/a'\n")).toEqual(['@/lib/a'])
  })
})

describe('resolveSpecifier', () => {
  it('resolves an @/ specifier against apps/sim', () => {
    expect(resolveSpecifier('@/lib/permission-groups/capabilities', __filename)).toMatch(
      /apps\/sim\/lib\/permission-groups\/capabilities\.ts$/
    )
  })

  it('returns null for a bare package specifier', () => {
    expect(resolveSpecifier('drizzle-orm', __filename)).toBeNull()
  })
})

describe('the guarded roots', () => {
  it('guards the universal route wrapper against the billing graph', () => {
    const wrapper = GUARDED_ROOTS.find(
      (guarded) => guarded.root === 'lib/core/utils/with-route-handler.ts'
    )
    expect(wrapper?.forbidden['lib/billing/']).toBeTruthy()
  })

  it('reaches no forbidden module tree at runtime', () => {
    for (const guarded of GUARDED_ROOTS) {
      expect({ root: guarded.root, violations: findViolations(guarded) }).toEqual({
        root: guarded.root,
        violations: [],
      })
    }
  })

  it('reports the shortest chain when a forbidden module is reachable', () => {
    /**
     * Walked from a module that legitimately imports the provider registry, so
     * the walker is proven able to fail. Without this the suite above would
     * still pass if `findViolations` silently stopped finding anything.
     */
    const violations = findViolations({
      root: 'lib/permission-groups/model-access.ts',
      forbidden: FORBIDDEN_PREFIXES,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0].forbidden).toBe('providers/utils.ts')
    expect(violations[0].reason).toBe(FORBIDDEN_PREFIXES['providers/'])
    expect(violations[0].path).toEqual([
      'lib/permission-groups/model-access.ts',
      'providers/utils.ts',
    ])
  })
})

describe('deferredSpecifiers', () => {
  it('collects a dynamic import, awaited or not', () => {
    expect(
      deferredSpecifiers(
        "const a = await import('@/lib/a')\nvoid import('@/lib/b').then(noop)\n" +
          "const { c } = await import(\n  '@/lib/c'\n)\n"
      )
    ).toEqual(['@/lib/a', '@/lib/b', '@/lib/c'])
  })

  it('ignores a `typeof import(…)` type query, which the compiler erases', () => {
    expect(deferredSpecifiers("type A = typeof import('@/lib/a')\n")).toEqual([])
  })

  it('leaves static forms to runtimeSpecifiers', () => {
    expect(deferredSpecifiers("import { a } from '@/lib/a'\nimport '@/lib/b'\n")).toEqual([])
  })
})

describe('a deferred edge into a forbidden tree', () => {
  /**
   * The evasion: a root that goes red on a static import is one keystroke from
   * green if `await import(…)` produces no edge. On the funnel's hot path the
   * deferral moves nothing — the registry loads on the first gated request
   * instead of on the first import — so the edge is reported.
   */
  it('is reported when a root defers the load of a forbidden module', () => {
    /**
     * Walked from a module that defers the block registry — `const
     * { getBlockRegistry } = await import('@/blocks/registry')` — and nothing
     * else about it matters here. Before the deferred pass this root was green
     * on `blocks/`, which is the whole evasion in one line.
     */
    const violations = findViolations({
      root: 'lib/copilot/chat/process-contents.ts',
      forbidden: { 'blocks/': FORBIDDEN_PREFIXES['blocks/'] },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0].forbidden).toBe('blocks/registry.ts')
    expect(violations[0].reason).toContain('deferred')
    expect(violations[0].path).toEqual([
      'lib/copilot/chat/process-contents.ts',
      'blocks/registry.ts',
    ])
  })

  /**
   * The other half of the rule, and the reason it is not "walk dynamic imports
   * like static ones": `lib/billing/core/subscription.ts` sits in the funnel's
   * static graph and lazily loads `@/components/emails` on a plan-upgrade
   * webhook — a template that statically imports the workflow graph. Walking
   * past the deferred hop reports a module nothing loads until that webhook
   * fires, which is a false alarm about what an authorization decision costs.
   */
  it('is not walked through, so a deferred module’s own graph stays out', () => {
    expect(
      findViolations({
        root: 'lib/billing/core/subscription.ts',
        forbidden: { 'lib/workflows/': FORBIDDEN_PREFIXES['lib/workflows/'] },
      })
    ).toEqual([])
  })
})
