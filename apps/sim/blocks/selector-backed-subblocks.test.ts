/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
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
/**
 * Context fields supplied by a sibling SUB-BLOCK value. `workspaceId` / `workflowId` come from
 * the surface itself and `excludeWorkflowId` from a flag, so none of them can be declared as a
 * `dependsOn` and none belong here.
 */
const SUB_BLOCK_SOURCED = new Set(
  [...SELECTOR_CONTEXT_FIELDS].filter(
    (field) => field !== 'workspaceId' && field !== 'workflowId' && field !== 'excludeWorkflowId'
  )
)

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

  it('declares dependsOn for every sub-block-sourced context field its selector reads', () => {
    // A selector's `getQueryKey` names every context field its RESULT depends on, and `enabled`
    // names what it is gated on. Both are probed rather than listing fields by hand, which is
    // what let `clickup.triggerWorkspaceId` ship without a `dependsOn`.
    //
    // The declaration is what makes the list refetch: `useFetchedOptions` resets its fetch scope
    // on `dependsOn` values changing. Without it the list loads once — before the credential is
    // picked, or against the old language — and never reloads.
    for (const { block, sub } of selectorBacked) {
      const definition = getSelectorDefinition(sub.selectorKey as SelectorKey)
      const probed = new Set<string>()
      const context = new Proxy({} as Record<string, unknown>, {
        get: (_target, property) => {
          if (typeof property === 'string') probed.add(property)
          return undefined
        },
      })
      const args = { key: definition.key, context }
      definition.getQueryKey(args)
      definition.enabled?.(args)

      const needed = [...probed].filter((field) => SUB_BLOCK_SOURCED.has(field))
      if (needed.length === 0) continue

      const dependsOn = sub.dependsOn
      const declared = new Set<string>(
        Array.isArray(dependsOn)
          ? dependsOn
          : [...(dependsOn?.all ?? []), ...(dependsOn?.any ?? [])]
      )
      expect(
        declared.size > 0,
        `${block}.${sub.id} uses ${sub.selectorKey}, whose result depends on ${needed.join(', ')}, but declares no dependsOn — its list would never refetch`
      ).toBe(true)
    }
  })
})
