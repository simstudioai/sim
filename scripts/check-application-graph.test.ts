import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PREFIXES, findViolations, runtimeSpecifiers } from './check-application-graph'

describe('runtimeSpecifiers', () => {
  /**
   * The heaviest edge of all — the module is loaded purely to run — and the one
   * nothing in the importing file names, so it was walked straight past.
   */
  it('collects a side-effect import, in source order', () => {
    expect(
      runtimeSpecifiers("import '@/lib/uploads/core/setup.server'\nimport { a } from '@/lib/a'\n")
    ).toEqual(['@/lib/uploads/core/setup.server', '@/lib/a'])
  })

  it('ignores type-only statements, which the compiler erases', () => {
    expect(
      runtimeSpecifiers(
        "import type { A } from '@/lib/a'\nimport type B from '@/lib/b'\nexport type { C } from '@/lib/c'\n"
      )
    ).toEqual([])
  })
})

describe('the guarded roots', () => {
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
     * { getBlockRegistry } = await import('@/blocks/registry')`. A root's own
     * deferred edges are checked before its static imports, so the reported chain
     * is that single deferred hop, whatever else the root reaches.
     */
    const root =
      'app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks/use-mention-data.ts'
    const violations = findViolations({
      root,
      forbidden: { 'blocks/': FORBIDDEN_PREFIXES['blocks/'] },
    })

    expect(violations).toHaveLength(1)
    expect(violations[0].forbidden).toBe('blocks/registry.ts')
    expect(violations[0].reason).toContain('deferred')
    expect(violations[0].path).toEqual([root, 'blocks/registry.ts'])
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
