import { describe, expect, it } from 'vitest'
import { workspaceFileColumns } from './schema'

describe('workspaceFileColumns', () => {
  it('exposes the canonical non-null byte size', () => {
    expect(workspaceFileColumns).toHaveProperty('sizeBytes')
    expect(workspaceFileColumns).not.toHaveProperty('size')
    expect(workspaceFileColumns.sizeBytes.notNull).toBe(true)
  })
})
