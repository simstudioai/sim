import { describe, expect, it } from 'vitest'
import { deleteR2BucketTool as t } from '@/tools/cloudflare/delete_r2_bucket'

const ok = { json: async () => ({ success: true }) } as unknown as Response
describe('delete_r2_bucket output is always a trimmed string', () => {
  it.each([
    ['  my-bucket  ', 'my-bucket'],
    ['my-bucket', 'my-bucket'],
  ])('string %s', async (i, e) => {
    expect((await t.transformResponse!(ok, { bucketName: i } as any)).output.name).toBe(e)
  })
  it('numeric bucket name becomes a string', async () => {
    const r = await t.transformResponse!(ok, { bucketName: 12345 } as any)
    expect(r.output.name).toBe('12345')
    expect(typeof r.output.name).toBe('string')
  })
  it('missing bucket name becomes an empty string', async () => {
    expect((await t.transformResponse!(ok, {} as any)).output.name).toBe('')
  })
})
