/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { collapseFolderPath } from '@/components/ui/folder-path-label'

describe('collapseFolderPath', () => {
  it('leaves a shallow chain untouched', () => {
    expect(collapseFolderPath([])).toEqual([])
    expect(collapseFolderPath(['Growth'])).toEqual(['Growth'])
    expect(collapseFolderPath(['Growth', 'Campaigns', 'Q3'])).toEqual(['Growth', 'Campaigns', 'Q3'])
  })

  it('drops whole ancestors rather than clipping one mid-word', () => {
    expect(collapseFolderPath(['Growth', 'Campaigns', 'Paid', 'Q3'])).toEqual(['Growth', '…', 'Q3'])
  })

  it('keeps the root and the leaf however deep the chain runs', () => {
    const deep = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    expect(collapseFolderPath(deep)).toEqual(['A', '…', 'G'])
  })

  it('does not mutate the input', () => {
    const segments = ['A', 'B', 'C', 'D']
    collapseFolderPath(segments)
    expect(segments).toEqual(['A', 'B', 'C', 'D'])
  })
})
