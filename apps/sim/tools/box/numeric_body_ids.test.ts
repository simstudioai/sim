/**
 * @vitest-environment node
 *
 * Guards the Box tools that put a folder id into a request **body** or query
 * against the id arriving as a JSON number.
 *
 * `url-path.ts`'s `toGuardedString` already names this hazard and fixes it for
 * path parameters, but the same bare `.trim()` survived in body builders. Box
 * ids are literally numeric strings — `"0"` is the root folder — so an LLM
 * emitting `0` rather than `"0"` is the ordinary case, not an exotic one, and
 * `.trim()` on a number is an unhandled `TypeError: x.trim is not a function`
 * surfaced to the user as a tool crash rather than a validation error.
 *
 * The same shape hides a second defect on the optional sites: `if
 * (params.parentFolderId)` is falsy for the number `0`, so a request naming the
 * root folder silently loses its `parent` instead of failing loudly.
 */
import { describe, expect, it } from 'vitest'
import { boxCopyFileTool } from '@/tools/box/copy_file'
import { boxCreateFolderTool } from '@/tools/box/create_folder'
import { boxSearchTool } from '@/tools/box/search'
import { boxUpdateFileTool } from '@/tools/box/update_file'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

function bodyOf(tool: AnyTool, params: Record<string, unknown>): Record<string, any> {
  const build = tool.request.body as (p: Record<string, unknown>) => Record<string, any>
  return build({ accessToken: 'TOKEN', ...params })
}

function urlOf(tool: AnyTool, params: Record<string, unknown>): URL {
  const build = tool.request.url as (p: Record<string, unknown>) => string
  return new URL(build({ accessToken: 'TOKEN', ...params }))
}

describe('box_create_folder parentFolderId coercion', () => {
  it('accepts a numeric folder id emitted as a JSON number', () => {
    expect(bodyOf(boxCreateFolderTool as AnyTool, { name: 'New', parentFolderId: 0 })).toEqual({
      name: 'New',
      parent: { id: '0' },
    })
  })

  it('still trims a string folder id byte-identically', () => {
    expect(
      bodyOf(boxCreateFolderTool as AnyTool, { name: 'New', parentFolderId: '  12345  ' })
    ).toEqual({ name: 'New', parent: { id: '12345' } })
  })

  it('reports a missing required folder id by name rather than crashing', () => {
    expect(() => bodyOf(boxCreateFolderTool as AnyTool, { name: 'New' })).toThrow(/parentFolderId/)
  })

  it('never addresses a folder literally named "null" or "undefined"', () => {
    expect(() =>
      bodyOf(boxCreateFolderTool as AnyTool, { name: 'New', parentFolderId: null })
    ).toThrow(/parentFolderId/)
  })
})

describe('box_copy_file parentFolderId coercion', () => {
  it('accepts a numeric folder id emitted as a JSON number', () => {
    expect(bodyOf(boxCopyFileTool as AnyTool, { fileId: '99', parentFolderId: 0 })).toEqual({
      parent: { id: '0' },
    })
  })

  it('still trims a string folder id byte-identically', () => {
    const body = bodyOf(boxCopyFileTool as AnyTool, {
      fileId: '99',
      parentFolderId: ' 42 ',
      name: 'copy.txt',
    })
    expect(body).toEqual({ parent: { id: '42' }, name: 'copy.txt' })
  })

  it('reports a missing required folder id by name rather than crashing', () => {
    expect(() => bodyOf(boxCopyFileTool as AnyTool, { fileId: '99' })).toThrow(/parentFolderId/)
  })
})

describe('box_update_file parentFolderId coercion', () => {
  it('accepts a numeric folder id emitted as a JSON number', () => {
    expect(bodyOf(boxUpdateFileTool as AnyTool, { fileId: '99', parentFolderId: 7 })).toEqual({
      parent: { id: '7' },
    })
  })

  it('keeps the root folder when it arrives as the number 0 instead of dropping it', () => {
    expect(bodyOf(boxUpdateFileTool as AnyTool, { fileId: '99', parentFolderId: 0 })).toEqual({
      parent: { id: '0' },
    })
  })

  it('still omits parent when the optional id is absent or empty', () => {
    expect(bodyOf(boxUpdateFileTool as AnyTool, { fileId: '99', name: 'x' })).toEqual({ name: 'x' })
    expect(
      bodyOf(boxUpdateFileTool as AnyTool, { fileId: '99', name: 'x', parentFolderId: '   ' })
    ).toEqual({ name: 'x' })
  })

  it('still trims a string folder id byte-identically', () => {
    expect(bodyOf(boxUpdateFileTool as AnyTool, { fileId: '99', parentFolderId: ' 12 ' })).toEqual({
      parent: { id: '12' },
    })
  })
})

describe('box_search ancestorFolderId coercion', () => {
  it('accepts a numeric folder id emitted as a JSON number', () => {
    const url = urlOf(boxSearchTool as AnyTool, { query: 'report', ancestorFolderId: 0 })
    expect(url.searchParams.get('ancestor_folder_ids')).toBe('0')
  })

  it('still trims a string folder id byte-identically', () => {
    const url = urlOf(boxSearchTool as AnyTool, { query: 'report', ancestorFolderId: ' 555 ' })
    expect(url.searchParams.get('ancestor_folder_ids')).toBe('555')
  })

  it('still omits the filter when the optional id is absent or empty', () => {
    expect(
      urlOf(boxSearchTool as AnyTool, { query: 'report' }).searchParams.get('ancestor_folder_ids')
    ).toBeNull()
    expect(
      urlOf(boxSearchTool as AnyTool, { query: 'report', ancestorFolderId: '  ' }).searchParams.get(
        'ancestor_folder_ids'
      )
    ).toBeNull()
  })
})
