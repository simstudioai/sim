import { describe, expect, it } from 'vitest'
import { planetScaleCreateBranchTool } from '@/tools/planetscale/create-branch'

describe('PlanetScale backup restores', () => {
  it.each([undefined, '', '   '])('rejects a restore without a cluster size: %j', (clusterSize) => {
    expect(() =>
      planetScaleCreateBranchTool.request.body!({
        serviceTokenId: 'test-id',
        serviceToken: 'test-secret',
        organization: 'example',
        database: 'test-db',
        name: 'restore-drill',
        backupId: 'backup-id',
        clusterSize,
      })
    ).toThrow('clusterSize is required when restoring a backup')
  })
})
