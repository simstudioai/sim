/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildForkMatrixChains,
  type ForkMatrixColumn,
  type ForkMatrixMappingRow,
} from '@/ee/workspace-forking/lib/mapping/matrix'

/** sandbox → uat → prod, the shape a staged lineage takes. */
const CHAIN: ForkMatrixColumn[] = [
  { id: 'sb', parentId: null },
  { id: 'uat', parentId: 'sb' },
  { id: 'prod', parentId: 'uat' },
]

const row = (
  childWorkspaceId: string,
  parentResourceId: string,
  childResourceId: string | null,
  resourceType: ForkMatrixMappingRow['resourceType'] = 'env_var'
): ForkMatrixMappingRow => ({ childWorkspaceId, resourceType, parentResourceId, childResourceId })

describe('buildForkMatrixChains', () => {
  it('composes per-edge rows into one chain across the lineage', () => {
    const chains = buildForkMatrixChains(CHAIN, [
      row('uat', 'API_KEY', 'API_KEY_UAT'),
      row('prod', 'API_KEY_UAT', 'API_KEY_PROD'),
    ])

    expect(chains).toHaveLength(1)
    expect(chains[0].originWorkspaceId).toBe('sb')
    expect(Object.fromEntries(chains[0].steps)).toEqual({
      sb: 'API_KEY',
      uat: 'API_KEY_UAT',
      prod: 'API_KEY_PROD',
    })
  })

  it('starts a chain at the shallowest workspace that knows the resource', () => {
    // Nothing maps INTO `LOCAL_ONLY` in uat, so the chain begins there rather than being grafted
    // onto whatever sandbox happens to call a resource by the same name.
    const chains = buildForkMatrixChains(CHAIN, [row('prod', 'LOCAL_ONLY', 'LOCAL_PROD')])

    expect(chains).toHaveLength(1)
    expect(chains[0].originWorkspaceId).toBe('uat')
    expect(chains[0].steps.get('sb')).toBeUndefined()
  })

  it('keeps two same-named resources apart when they start in different workspaces', () => {
    const chains = buildForkMatrixChains(CHAIN, [
      row('uat', 'TOKEN', 'TOKEN_UAT'),
      row('prod', 'OTHER', 'OTHER_PROD'),
    ])
    expect(chains.map((chain) => chain.originResourceId).sort()).toEqual(['OTHER', 'TOKEN'])
  })

  it('gives a downstream workspace an empty cell when no row exists yet', () => {
    const chains = buildForkMatrixChains(CHAIN, [row('uat', 'API_KEY', 'API_KEY_UAT')])
    // uat resolved, so prod still deserves a cell — that is where the mapping gets created.
    expect(chains[0].steps.get('prod')).toBeNull()
  })

  it('stops descending once a chain maps to nothing, since there is no source to key on', () => {
    const chains = buildForkMatrixChains(CHAIN, [row('uat', 'API_KEY', null)])
    expect(chains[0].steps.get('uat')).toBeNull()
    expect(chains[0].steps.has('prod')).toBe(false)
  })

  it('spans a branch, giving one chain a cell in every fork of the same parent', () => {
    const branched: ForkMatrixColumn[] = [
      { id: 'root', parentId: null },
      { id: 'left', parentId: 'root' },
      { id: 'right', parentId: 'root' },
    ]
    const chains = buildForkMatrixChains(branched, [
      row('left', 'KEY', 'KEY_LEFT'),
      row('right', 'KEY', 'KEY_RIGHT'),
    ])

    expect(chains).toHaveLength(1)
    expect(Object.fromEntries(chains[0].steps)).toEqual({
      root: 'KEY',
      left: 'KEY_LEFT',
      right: 'KEY_RIGHT',
    })
  })

  it('keeps chains of different resource types separate even on the same ids', () => {
    const chains = buildForkMatrixChains(CHAIN, [
      row('uat', 'shared', 'shared-uat', 'env_var'),
      row('uat', 'shared', 'shared-uat-table', 'table'),
    ])
    expect(chains).toHaveLength(2)
    expect(chains.map((chain) => chain.resourceType).sort()).toEqual(['env_var', 'table'])
  })

  it('ignores rows whose child workspace is not a column of this matrix', () => {
    const chains = buildForkMatrixChains(
      [{ id: 'sb', parentId: null }],
      [row('elsewhere', 'API_KEY', 'API_KEY_X')]
    )
    expect(chains).toEqual([])
  })
})
