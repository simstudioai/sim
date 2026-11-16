import { describe, expect, it } from 'vitest'
import { WordPressBlock } from '@/blocks/blocks/wordpress'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = WordPressBlock.tools.config?.params
  if (!mapper) throw new Error('WordPress block has no params mapper')
  return mapper(params, context)
}

/** The tool-call path: merged args, then the mapper result spread over them. */
function toolCallParams(modelArgs: Record<string, unknown>, operation: string) {
  return { ...modelArgs, ...mapParams(modelArgs, { operation }) }
}

describe('WordPress tool calls', () => {
  it.each([
    [
      'wordpress_create_comment',
      { siteId: 's', postId: '42', content: 'Thanks!', parent: 17, authorName: 'Ann' },
      { postId: 42, content: 'Thanks!', parent: 17, authorName: 'Ann' },
    ],
    [
      'wordpress_create_category',
      { siteId: 's', name: 'News', description: 'd', slug: 'news', parent: '3' },
      { name: 'News', description: 'd', slug: 'news', parent: 3 },
    ],
    [
      'wordpress_update_tag',
      { siteId: 's', tagId: 9, name: 'Renamed', slug: 'renamed' },
      { tagId: 9, name: 'Renamed', slug: 'renamed' },
    ],
    [
      'wordpress_update_comment',
      { siteId: 's', commentId: 5, content: 'edited', status: 'hold' },
      { commentId: 5, content: 'edited', status: 'hold' },
    ],
    [
      'wordpress_list_posts',
      { siteId: 's', status: 'draft', author: '7' },
      { status: 'draft', author: 7 },
    ],
    ['wordpress_search_content', { siteId: 's', query: 'q', subtype: 'page' }, { subtype: 'page' }],
  ])(
    '%s keeps the model args the block renames from its own fields',
    (operation, args, expected) => {
      expect(toolCallParams(args, operation)).toMatchObject(expected)
    }
  )

  it('unwraps a stored single-file array for upload_media', () => {
    const file = { name: 'a.png', key: 'k', url: 'u', size: 1, type: 'image/png' }
    expect(toolCallParams({ siteId: 's', file: [file] }, 'wordpress_upload_media').file).toEqual(
      file
    )
  })
})

describe('WordPress list comments order', () => {
  it('drops an Order By the comments endpoint rejects and keeps a valid one', () => {
    const base = { operation: 'wordpress_list_comments', siteId: 's' }
    expect(mapParams({ ...base, orderBy: 'title' }).orderBy).toBeUndefined()
    expect(mapParams({ ...base, orderBy: 'id' }).orderBy).toBe('id')
  })
})
