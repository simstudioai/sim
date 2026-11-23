import { describe, expect, it } from 'vitest'
import { deletePostTool } from '@/tools/wordpress/delete_post'
import { deleteTagTool } from '@/tools/wordpress/delete_tag'
import { getCurrentUserTool } from '@/tools/wordpress/get_current_user'
import { listCommentsTool } from '@/tools/wordpress/list_comments'
import { updatePostTool } from '@/tools/wordpress/update_post'

const auth = { accessToken: 't' }

function buildUrl<P>(url: string | ((params: P) => string), params: P): string {
  return typeof url === 'function' ? url(params) : url
}

describe('WordPress request paths', () => {
  it('keeps an injected query in a site ID out of the query string', () => {
    const url = new URL(
      buildUrl(deletePostTool.request.url, {
        ...auth,
        siteId: 'mysite.com?force=true#',
        postId: 42,
      })
    )
    expect(url.searchParams.has('force')).toBe(false)
    expect(url.pathname.endsWith('/mysite.com%3Fforce%3Dtrue%23/posts/42')).toBe(true)
  })

  it('rejects a site ID carrying a path', () => {
    expect(() =>
      buildUrl(deleteTagTool.request.url, {
        ...auth,
        siteId: 'mysite.wordpress.com/posts/42?force=true#',
        tagId: 1,
      })
    ).toThrow('siteId')
  })

  it('requests the edit context for the current user so email and roles are returned', () => {
    const url = new URL(buildUrl(getCurrentUserTool.request.url, { ...auth, siteId: '123' }))
    expect(url.searchParams.get('context')).toBe('edit')
  })

  it('maps the approved comment filter to the value WordPress matches', () => {
    const url = new URL(
      buildUrl(listCommentsTool.request.url, { ...auth, siteId: '123', status: 'approved' })
    )
    expect(url.searchParams.get('status')).toBe('approve')
  })
})

describe('WordPress term ID lists', () => {
  it.each([
    ['comma string', '3, 4,'],
    ['array', [3, '4']],
  ])('accepts categories as a %s', (_label, categories) => {
    const body = updatePostTool.request.body?.({
      ...auth,
      siteId: '123',
      postId: 1,
      categories: categories as string,
    })
    expect((body as Record<string, unknown> | undefined)?.categories).toEqual([3, 4])
  })
})
