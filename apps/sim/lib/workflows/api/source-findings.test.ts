/**
 * @vitest-environment node
 */
import { createBlock } from '@sim/testing/factories/block.factory'
import { canonicalize } from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it, vi } from 'vitest'
import { boundSourceFindings } from '@/lib/workflows/api/source-findings'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'

vi.unmock('@/blocks/registry')
vi.unmock('@/tools/metadata-outputs')

describe('workflow source findings at the answer edge', () => {
  it('caps a stored workflow whose canonicalize floods unresolved ids, ending in one I_FINDINGS_TRUNCATED', () => {
    const count = 120
    const blocks: WorkflowState['blocks'] = {}
    for (let index = 0; index < count; index++) {
      const id = `t${index}`
      blocks[id] = createBlock({
        id,
        type: 'table',
        name: `Table ${index}`,
        subBlocks: {
          tableSelector: { id: 'tableSelector', type: 'table-selector', value: `gone-${index}` },
        },
      })
    }
    const canonical = canonicalize(
      { blocks, edges: [], loops: {}, parallels: {} },
      {
        catalog,
        meta: { name: 'Flood', description: null },
        resources: { toKey: () => null, toId: () => null },
      }
    )
    const unresolved = (list: ReadonlyArray<{ code: string }>) =>
      list.filter((finding) => finding.code === 'W_CANON_UNRESOLVED_ID').length
    expect(unresolved(canonical.diagnostics)).toBe(count)

    const answer = boundSourceFindings(canonical.diagnostics)

    expect(unresolved(answer)).toBe(20)
    const markers = answer.filter((finding) => finding.code === 'I_FINDINGS_TRUNCATED')
    expect(markers).toHaveLength(1)
    expect(answer.at(-1)).toMatchObject({
      code: 'I_FINDINGS_TRUNCATED',
      severity: 'info',
      message: expect.stringContaining(`${count - 20} more`),
    })
  })
})
