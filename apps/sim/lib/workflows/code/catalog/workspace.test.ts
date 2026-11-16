/**
 * The compile-catalog cache is shared by every request in the process, so its key is a tenant
 * boundary. These cover the two ways a wrong key would surface: one organization's custom blocks
 * served to another, and a custom block publish that keeps serving the catalog from before it.
 */
import { catalogBlock } from '@sim/workflow-code'
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { type CatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { buildSourceCatalog } from '@/lib/workflows/code/catalog/workspace'
import type { CustomBlockOverlayRow } from '@/blocks/custom/server-overlay'

function gateWith(customBlockRows: CustomBlockOverlayRow[]): CatalogGate {
  return {
    visibility: { revealed: new Set(), disabled: new Set(), previewTagged: new Set() },
    allowedIntegrations: null,
    customBlockRows,
  }
}

function customRow(type: string, inputNames: string[]): CustomBlockOverlayRow {
  return {
    type,
    name: type,
    description: 'Deployed as a block',
    workflowId: `${type}-workflow`,
    inputFields: inputNames.map((name) => ({ id: `${type}-${name}`, name, type: 'string' })),
  }
}

function catalogFor(organizationId: string, gate: CatalogGate) {
  return withCatalogBlockScope(gate, async () =>
    buildSourceCatalog({ gate, organizationId, storedTypes: [] })
  )
}

function inputIds(catalog: Awaited<ReturnType<typeof catalogFor>>, type: string) {
  return catalogBlock(catalog, type)?.subBlocks.map((subBlock) => subBlock.id) ?? []
}

describe('source catalog cache', () => {
  it('never serves one organization the catalog holding another organization custom blocks', async () => {
    const orgA = await catalogFor('org-a', gateWith([customRow('custom_block_a', ['lead'])]))
    const orgB = await catalogFor('org-b', gateWith([customRow('custom_block_b', ['ticket'])]))
    const orgC = await catalogFor('org-c', gateWith([]))

    expect(catalogBlock(orgA, 'custom_block_a')).toBeDefined()
    expect(catalogBlock(orgA, 'custom_block_b')).toBeUndefined()
    expect(catalogBlock(orgB, 'custom_block_b')).toBeDefined()
    expect(catalogBlock(orgB, 'custom_block_a')).toBeUndefined()
    expect(catalogBlock(orgC, 'custom_block_a')).toBeUndefined()
    expect(catalogBlock(orgC, 'custom_block_b')).toBeUndefined()
    expect(new Set([orgA.hash, orgB.hash, orgC.hash]).size).toBe(3)
  })

  it('scopes a catalog to its organization even when another holds an identical custom block', async () => {
    const row = customRow('custom_block_shared', ['lead'])
    const first = await catalogFor('org-d', gateWith([row]))
    const second = await catalogFor('org-e', gateWith([{ ...row }]))

    expect(first.scope).toEqual({ organizationId: 'org-d' })
    expect(second.scope).toEqual({ organizationId: 'org-e' })
  })

  it('serves the new catalog after a custom block is republished with different inputs', async () => {
    const before = await catalogFor('org-f', gateWith([customRow('custom_block_f', ['lead'])]))
    const cached = await catalogFor('org-f', gateWith([customRow('custom_block_f', ['lead'])]))
    const after = await catalogFor(
      'org-f',
      gateWith([customRow('custom_block_f', ['lead', 'score'])])
    )

    expect(cached).toBe(before)
    expect(after).not.toBe(before)
    expect(after.hash).not.toBe(before.hash)
    expect(inputIds(before, 'custom_block_f')).not.toContain('custom_block_f-score')
    expect(inputIds(after, 'custom_block_f')).toContain('custom_block_f-score')
  })

  it('serves the new catalog after a custom block is disabled', async () => {
    const enabled = await catalogFor('org-g', gateWith([customRow('custom_block_g', ['lead'])]))
    const disabled = await catalogFor(
      'org-g',
      gateWith([{ ...customRow('custom_block_g', ['lead']), enabled: false }])
    )

    expect(catalogBlock(enabled, 'custom_block_g')).toBeDefined()
    expect(catalogBlock(disabled, 'custom_block_g')).toBeUndefined()
  })
})
