/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isResourceListEmpty } from '@/app/workspace/[workspaceId]/components/resource/is-resource-list-empty'

/** A workspace that genuinely holds nothing — the one case that earns the graphic. */
const EMPTY = {
  rowCount: 0,
  isLoading: false,
  isPlaceholderData: false,
  error: null,
  search: '',
  filterCount: 0,
  folderId: null,
  foldersResolved: true,
} as const

describe('isResourceListEmpty', () => {
  it('is true only when the list genuinely holds nothing', () => {
    expect(isResourceListEmpty(EMPTY)).toBe(true)
  })

  it('is false as soon as the list has a row', () => {
    expect(isResourceListEmpty({ ...EMPTY, rowCount: 1 })).toBe(false)
  })

  it.each([
    ['the first load is still in flight', { isLoading: true }],
    ['the query is serving the previous key rows', { isPlaceholderData: true }],
    ['the load failed', { error: new Error('boom') }],
    ['the folder tree has not resolved', { foldersResolved: false }],
  ])('is false while %s', (_label, override) => {
    expect(isResourceListEmpty({ ...EMPTY, ...override })).toBe(false)
  })

  it.each([
    ['a search is active', { search: 'invoices' }],
    ['a filter is applied', { filterCount: 1 }],
    ['a subfolder is open', { folderId: 'folder-1' }],
  ])('is false when %s, because the copy would be wrong', (_label, override) => {
    expect(isResourceListEmpty({ ...EMPTY, ...override })).toBe(false)
  })

  it('ignores a whitespace-only search, which filters no rows either', () => {
    expect(isResourceListEmpty({ ...EMPTY, search: '   ' })).toBe(true)
  })

  it('treats a list without folder navigation as resolved at the root', () => {
    const { folderId, foldersResolved, ...withoutFolders } = EMPTY
    expect(isResourceListEmpty(withoutFolders)).toBe(true)
  })
})
