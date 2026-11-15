import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { DropboxBlock } from '@/blocks/blocks/dropbox'

function requiredFor(subBlockId: string, values: Record<string, unknown>) {
  const subBlock = DropboxBlock.subBlocks.find(
    (candidate) => candidate.id === subBlockId && typeof candidate.required === 'function'
  )
  if (!subBlock || typeof subBlock.required !== 'function') {
    throw new Error(`${subBlockId} has no dynamic required condition`)
  }
  return subBlock.required(values)
}

describe('Dropbox cursor continuation', () => {
  it('requires a folder path only until a list folder cursor is set', () => {
    expect(requiredFor('path', {})).toEqual({ field: 'operation', value: 'dropbox_list_folder' })
    expect(requiredFor('path', { listFolderCursor: '   ' })).toEqual({
      field: 'operation',
      value: 'dropbox_list_folder',
    })
    expect(requiredFor('path', { listFolderCursor: 'cursor-1' })).toEqual({
      field: 'operation',
      value: [],
    })
  })

  it('requires a search query only until a search cursor is set', () => {
    expect(requiredFor('query', {})).toEqual({ field: 'operation', value: 'dropbox_search' })
    expect(requiredFor('query', { searchCursor: 'cursor-1' })).toEqual({
      field: 'operation',
      value: [],
    })
  })
})
