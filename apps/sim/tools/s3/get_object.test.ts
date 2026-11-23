/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { s3GetObjectTool } from '@/tools/s3/get_object'
import { generatePresignedUrl } from '@/tools/s3/utils'

/**
 * Golden values. The inline-key ones were produced by the signer as it shipped
 * before saved AWS credentials existed, so an inline block's request must stay
 * byte-identical. The session-token header was cross-checked against the AWS
 * SDK's SignatureV4 for the same request and instant.
 */
const SIGNING_INSTANT = new Date('2026-11-06T12:00:00.000Z')
const SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

function headersFor(params: Record<string, string>) {
  return s3GetObjectTool.request.headers({ region: 'us-east-1', ...params } as never) as Record<
    string,
    string
  >
}

describe('s3_get_object request signing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(SIGNING_INSTANT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signs an inline-key request exactly as before', () => {
    const headers = headersFor({
      s3Uri: 'https://my-bucket.s3.us-east-1.amazonaws.com/reports/q3 final.pdf',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: SECRET_ACCESS_KEY,
    })

    expect(headers).toStrictEqual({
      Host: 'my-bucket.s3.us-east-1.amazonaws.com',
      'X-Amz-Content-Sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'X-Amz-Date': '20261106T120000Z',
      Authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261106/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=7b42995a8918cd5cff03dfde5ea93c2014f2dd5805aeea36e63167966ad47478',
    })
  })

  it("escapes !'()* in the key the way the AWS SDK's SignatureV4 does", () => {
    const headers = headersFor({
      s3Uri: "https://my-bucket.s3.us-east-1.amazonaws.com/reports/q3 (final)!*'.pdf",
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: SECRET_ACCESS_KEY,
    })

    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261106/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=d3ac6102b527b7f08b266cbb9e733f4875c91cabbea21fc724476ff6e58ce400'
    )
  })

  it('presigns an inline-key download URL exactly as before', () => {
    expect(
      generatePresignedUrl(
        {
          region: 'us-east-1',
          bucketName: 'my-bucket',
          objectKey: 'reports/q3 final.pdf',
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: SECRET_ACCESS_KEY,
        },
        3600
      )
    ).toBe(
      'https://my-bucket.s3.us-east-1.amazonaws.com/reports/q3%20final.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261106%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261106T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=e2b8fb77f53acedce8be1f2d1ddaf77a60f24a7cfc352c2213b2a99f6e23afc3'
    )
  })

  it('signs temporary credentials with their session token the way AWS SigV4 does', () => {
    const sessionToken = 'IQoJb3JpZ2luX2VjEXAMPLE+token/with=chars'
    const headers = headersFor({
      s3Uri: 'https://my-bucket.s3.us-east-1.amazonaws.com/reports/q3.pdf',
      accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
      secretAccessKey: SECRET_ACCESS_KEY,
      sessionToken,
    })

    expect(headers['X-Amz-Security-Token']).toBe(sessionToken)
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=ASIAIOSFODNN7EXAMPLE/20261106/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=a730f1edde0ef22283c0b5e1f714592d38c53743a3330d971cd66932a3297c2e'
    )
  })

  it('carries the session token in a temporary-credential presigned URL', () => {
    const url = new URL(
      generatePresignedUrl(
        {
          region: 'us-east-1',
          bucketName: 'my-bucket',
          objectKey: 'reports/q3.pdf',
          accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
          secretAccessKey: SECRET_ACCESS_KEY,
          sessionToken: 'IQoJb3JpZ2luX2VjEXAMPLE+token/with=chars',
        },
        3600
      )
    )

    expect(url.searchParams.get('X-Amz-Security-Token')).toBe(
      'IQoJb3JpZ2luX2VjEXAMPLE+token/with=chars'
    )
    expect(url.search).toContain(
      'X-Amz-Security-Token=IQoJb3JpZ2luX2VjEXAMPLE%2Btoken%2Fwith%3Dchars'
    )
  })
})
