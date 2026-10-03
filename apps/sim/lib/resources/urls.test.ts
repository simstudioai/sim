import { describe, expect, it } from 'vitest'
import { workspaceResourcePath } from '@/lib/resources'

describe('workspace resource URLs', () => {
  it('encodes route parameters', () => {
    expect(workspaceResourcePath('workspace one', 'table', 'table/two')).toBe(
      '/workspace/workspace%20one/tables/table%2Ftwo'
    )
  })
})
