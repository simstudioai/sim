/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import {
  getSelectorManifestEntry,
  type SelectorKey,
  selectorManifest,
} from '@/lib/selectors/manifest'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import { getAllBlocks } from '@/blocks/registry'

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
  [...SELECTOR_CONTEXT_FIELDS].filter((field) => field !== 'excludeWorkflowId')
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

  it('names a selector that is present in the exhaustive manifest', () => {
    for (const { block, sub } of selectorBacked) {
      expect(
        Object.hasOwn(selectorManifest, sub.selectorKey),
        `${block}.${sub.id} points at unregistered selector ${sub.selectorKey}`
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

  it('declares dependsOn when a selector reads sub-block-sourced context', () => {
    // The manifest is the browser-safe declaration of every context field the result may read.
    //
    // The declaration gates the request and makes dependency changes advance the opaque query
    // revision. Exact optional-source behavior is characterized in the shared context tests.
    for (const { block, sub } of selectorBacked) {
      const manifest = getSelectorManifestEntry(sub.selectorKey as SelectorKey)
      const needed = manifest.context.allowed.filter((field) => SUB_BLOCK_SOURCED.has(field))
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

  it('declares optional cascade fields whose values change provider enumeration', () => {
    const cases = [{ block: 'microsoft_excel', subBlock: 'spreadsheetId', dependency: 'driveId' }]

    for (const expected of cases) {
      const match = selectorBacked.find(
        ({ block, sub }) => block === expected.block && sub.id === expected.subBlock
      )
      expect(match, `${expected.block}.${expected.subBlock} is missing`).toBeDefined()
      const dependsOn = match?.sub.dependsOn
      const declared = Array.isArray(dependsOn)
        ? dependsOn
        : [...(dependsOn?.all ?? []), ...(dependsOn?.any ?? [])]
      expect(
        declared,
        `${expected.block}.${expected.subBlock} must send ${expected.dependency}`
      ).toContain(expected.dependency)
    }
  })
})
