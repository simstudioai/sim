import { describe, expect, it } from 'vitest'
import { boxListFolderItemsTool } from '@/tools/box/list_folder_items'
import type { BoxUpdateFileParams } from '@/tools/box/types'
import { boxUpdateFileTool } from '@/tools/box/update_file'

function listQuery(params: { folderId: string; usemarker?: boolean; sort?: string }) {
  const buildUrl = boxListFolderItemsTool.request.url
  if (typeof buildUrl !== 'function') throw new Error('list folder items must build its URL')
  return new URL(buildUrl({ accessToken: 't', ...params })).searchParams
}

describe('Box list folder items sort', () => {
  it('omits sort with marker pagination on the root folder', () => {
    expect(listQuery({ folderId: '0', usemarker: true, sort: 'name' }).get('sort')).toBeNull()
  })

  it('keeps sort for other folders and for offset pagination on the root', () => {
    expect(listQuery({ folderId: '123', usemarker: true, sort: 'name' }).get('sort')).toBe('name')
    expect(listQuery({ folderId: '0', sort: 'name' }).get('sort')).toBe('name')
  })
})

describe('Box update file description', () => {
  function body(params: Record<string, unknown>) {
    const build = boxUpdateFileTool.request.body
    if (!build) throw new Error('update file must build a body')
    return build({ accessToken: 't', fileId: '1', ...params } as BoxUpdateFileParams)
  }

  it('does not send an untouched null description', () => {
    expect(body({ name: 'a.pdf', description: null })).not.toHaveProperty('description')
  })

  it('sends an explicit description, including an empty one', () => {
    expect(body({ description: '' })).toHaveProperty('description', '')
  })
})
