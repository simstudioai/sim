import { describe, expect, it } from 'vitest'
import { parseS3Uri } from '@/tools/s3/utils'

describe('parseS3Uri', () => {
  it.each([
    ['https://my-bucket.s3.us-west-2.amazonaws.com/a/b.txt', undefined, 'my-bucket', 'us-west-2'],
    ['https://s3.amazonaws.com/Legacy_Bucket/key', undefined, 'Legacy_Bucket', 'us-east-1'],
    ['https://my-bucket.s3.amazonaws.com/key', 'eu-central-1', 'my-bucket', 'eu-central-1'],
  ])('parses %s', (uri, region, bucketName, expectedRegion) => {
    expect(parseS3Uri(uri, region)).toMatchObject({ bucketName, region: expectedRegion })
  })

  /** The bucket and region become the request host, which carries signed AWS credentials. */
  it.each([
    ['https://my-bucket.s3.amazonaws.com/key', 'evil.example#'],
    ['https://s3.amazonaws.com/evil.example%23/key', undefined],
    ['https://s3.amazonaws.com/evil.example%2Fpath/key', undefined],
  ])('refuses a bucket or region that would move the host: %s %s', (uri, region) => {
    expect(() => parseS3Uri(uri, region)).toThrow()
  })
})
