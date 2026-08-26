import { describe, expect, it } from 'vitest'
import { workspaceFileColumns } from './schema'

describe('workspaceFileColumns', () => {
  it('excludes the legacy size bridge from application projections', () => {
    expect(workspaceFileColumns).toHaveProperty('sizeBytes')
    expect(workspaceFileColumns).not.toHaveProperty('size')
  })
})
