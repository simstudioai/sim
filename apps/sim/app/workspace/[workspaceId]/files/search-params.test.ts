import { describe, expect, it } from 'vitest'
import { filesBrowserListParams } from '@/app/workspace/[workspaceId]/files/search-params'

const VIEW = {
  folderId: 'folder-1',
  search: '',
  sort: 'updated',
  dir: 'desc',
  type: [],
  size: [],
  uploadedBy: [],
} as const

describe('filesBrowserListParams', () => {
  it('lists the open folder until a search is typed, then searches every folder', () => {
    expect(filesBrowserListParams(VIEW)).toMatchObject({ folderId: 'folder-1' })
    expect(filesBrowserListParams(VIEW)).not.toHaveProperty('q')

    const searching = filesBrowserListParams({ ...VIEW, search: '  report ' })
    expect(searching).toMatchObject({ q: 'report' })
    expect(searching).not.toHaveProperty('folderId')
  })
})
