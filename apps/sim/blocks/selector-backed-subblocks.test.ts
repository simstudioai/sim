/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { getAllBlocks } from '@/blocks/registry'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorKey } from '@/hooks/selectors/types'

/**
 * Guards the two invariants a selector-backed sub-block relies on, both of which broke silently
 * when `fetchOptions` was replaced by `selectorKey`.
 *
 * A selector-backed field carries no static `options` — that is the point — so every consumer
 * has to tolerate the absence. The controls read `options` on first paint, before any fetch
 * resolves, and an unguarded `.map` there takes out the whole editor for that block.
 */
describe('selector-backed sub-blocks', () => {
  const selectorBacked = getAllBlocks().flatMap((block) =>
    ((block.subBlocks ?? []) as Array<Record<string, any>>)
      .filter((sub) => sub.selectorKey)
      .map((sub) => ({ block: block.type, sub }))
  )

  it('covers a meaningful number of fields', () => {
    // A guard on the guard: if the registry ever stops resolving, the assertions below would
    // pass vacuously over an empty list.
    expect(selectorBacked.length).toBeGreaterThan(50)
  })

  it('names a selector that is actually registered and can list', () => {
    for (const { block, sub } of selectorBacked) {
      const definition = getSelectorDefinition(sub.selectorKey as SelectorKey)
      expect(
        Boolean(definition.fetchList || definition.fetchPage),
        `${block}.${sub.id} points at ${sub.selectorKey}, which can neither list nor page`
      ).toBe(true)
    }
  })

  it('never also declares a static options array', () => {
    // Two sources for one list. The controls prefer fetched options only when non-empty, so a
    // leftover array would show through whenever the fetch is empty or still in flight.
    for (const { block, sub } of selectorBacked) {
      expect(
        sub.options,
        `${block}.${sub.id} declares both selectorKey and options`
      ).toBeUndefined()
    }
  })

  it('declares dependsOn for every context field its selector requires', () => {
    // A selector gated on `enabled` returns nothing until its context is populated, and the
    // context is only rebuilt when a `dependsOn` sibling changes. Without the declaration the
    // list loads once, empty, and never refetches when the credential is picked.
    const CONTEXT_SOURCED = new Set(['oauthCredential', 'credentialGroupId', 'tableId'])
    for (const { block, sub } of selectorBacked) {
      const definition = getSelectorDefinition(sub.selectorKey as SelectorKey)
      if (!definition.enabled) continue
      const probed = new Set<string>()
      definition.enabled({
        key: definition.key,
        context: new Proxy({} as Record<string, unknown>, {
          get: (_target, property) => {
            if (typeof property === 'string') probed.add(property)
            return undefined
          },
        }),
      })
      const needsContext = [...probed].some((field) => CONTEXT_SOURCED.has(field))
      if (!needsContext) continue
      const dependsOn = sub.dependsOn
      const declared = Array.isArray(dependsOn)
        ? dependsOn.length > 0
        : Boolean(dependsOn?.all?.length || dependsOn?.any?.length)
      expect(
        declared,
        `${block}.${sub.id} uses ${sub.selectorKey}, which is gated on context, but declares no dependsOn`
      ).toBe(true)
    }
  })
})
