/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveComparePair } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/compare-pair'

describe('resolveComparePair', () => {
  it('compares the closest previous saved version to the selected version despite gaps or ordering', () => {
    const versions = [{ version: 9 }, { version: 2 }, { version: 7 }, { version: 5 }]
    expect(resolveComparePair(7, versions)).toEqual({
      base: { kind: 'version', version: 5 },
      target: { kind: 'version', version: 7 },
    })
    expect(resolveComparePair(9, versions)).toEqual({
      base: { kind: 'version', version: 7 },
      target: { kind: 'version', version: 9 },
    })
  })

  it('compares the earliest available version to draft when it has no predecessor', () => {
    expect(resolveComparePair(1, [{ version: 2 }, { version: 1 }])).toEqual({
      base: { kind: 'version', version: 1 },
      target: { kind: 'draft' },
    })
    expect(resolveComparePair(4, [{ version: 4 }])).toEqual({
      base: { kind: 'version', version: 4 },
      target: { kind: 'draft' },
    })
  })
})
