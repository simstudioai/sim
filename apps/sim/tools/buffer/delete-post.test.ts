import { describe, expect, it } from 'vitest'
import { bufferDeletePostTool } from '@/tools/buffer/delete_post'

describe('Buffer post deletion responses', () => {
  it.each([undefined, null, '', { id: 'post-1' }])(
    'rejects success responses with an invalid deleted post ID: %j',
    async (id) => {
      const transform = bufferDeletePostTool.transformResponse
      if (!transform) throw new Error('Missing delete response transformer')

      await expect(
        transform(Response.json({ data: { deletePost: { __typename: 'DeletePostSuccess', id } } }))
      ).rejects.toThrow('Buffer returned an invalid deleted post ID')
    }
  )

  it('preserves the provider-confirmed deleted post ID', async () => {
    const transform = bufferDeletePostTool.transformResponse
    if (!transform) throw new Error('Missing delete response transformer')

    const result = await transform(
      Response.json({ data: { deletePost: { __typename: 'DeletePostSuccess', id: 'post-1' } } })
    )

    expect(result).toEqual({ success: true, output: { deleted: true, id: 'post-1' } })
  })
})
