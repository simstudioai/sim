/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getExposedIntegrationTools } from '@/lib/mothership/integration-tools'
import { BLOCK_REGISTRY } from '@/blocks/registry-maps'

/**
 * Sweeps the real registry for the invariant the permission gate depends on.
 *
 * A permission group's `deniedTools` holds the ids an admin sees in the access
 * control grid, which are exactly the owning block's `tools.access` entries.
 * The gate compares ids verbatim, so if an exposed tool were ever published
 * under an id its block does not declare — a `_v2` superseding a still-declared
 * v1, say — denying the declared id would leave the exposed one advertised and
 * callable. Pin it here so that authoring mistake fails at CI rather than
 * silently widening what a governed workspace can reach.
 */
describe('exposed integration tool invariants', () => {
  it('publishes every tool under an id its owning block declares', () => {
    const drift = getExposedIntegrationTools()
      .filter(
        (tool) => !(BLOCK_REGISTRY[tool.blockType]?.tools?.access ?? []).includes(tool.toolId)
      )
      .map((tool) => `${tool.blockType} publishes ${tool.toolId}, which it does not declare`)

    expect(drift).toEqual([])
  })
})
