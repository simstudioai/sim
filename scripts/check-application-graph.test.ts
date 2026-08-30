import { describe, expect, it } from 'vitest'
import {
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
    ).toEqual(['@/lib/a', '@/lib/b'])
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
