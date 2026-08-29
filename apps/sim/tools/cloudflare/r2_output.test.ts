import { describe, expect, it } from 'vitest'
import { deleteR2BucketTool as t } from '@/tools/cloudflare/delete_r2_bucket'

const buildUrl = (bucketName: unknown) =>
  (t.request.url as (p: Record<string, unknown>) => string)({
    apiKey: 'k',
    accountId: 'acc',
    bucketName,
  })

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

/**
 * Deleting a bucket is irreversible, and `bucketName` is one of only five
 * params this PR newly trims, so a padded name is refused rather than
 * canonicalized. No valid R2 name has surrounding whitespace to lose.
 */
describe('delete_r2_bucket refuses a padded bucket name', () => {
  it.each(['  my-bucket  ', 'my-bucket ', ' my-bucket', '\tmy-bucket', 'my-bucket\n'])(
    'rejects %j',
    (name) => {
      expect(() => buildUrl(name)).toThrow(/leading or trailing whitespace/)
    }
  )

  it.each(['my-bucket', 'bucket-123', 'abc', '12345'])('still accepts %j', (name) => {
    expect(new URL(buildUrl(name)).pathname).toBe(`/client/v4/accounts/acc/r2/buckets/${name}`)
  })

  it('still rejects a traversal', () => {
    expect(() => buildUrl('..')).toThrow(/path traversal is not allowed/)
  })

  it('get_r2_bucket, a read of the same resource, still trims', async () => {
    const { getR2BucketTool } = await import('@/tools/cloudflare/get_r2_bucket')
    const url = (getR2BucketTool.request.url as (p: Record<string, unknown>) => string)({
      apiKey: 'k',
      accountId: 'acc',
      bucketName: '  my-bucket  ',
    })

    expect(new URL(url).pathname).toBe('/client/v4/accounts/acc/r2/buckets/my-bucket')
  })
})
