/**
 * Pins the S3 connector's two signing paths. Inline keys sign exactly as they
 * always have; a saved AWS credential (seeded into `syncContext` by the token
 * resolver) signs with its STS session token and only ever for Amazon S3 — a
 * custom S3-compatible endpoint would otherwise receive the customer's AWS
 * session.
 */
import { knowledgeDocumentsUtilsMock } from '@sim/testing/mocks/knowledge-documents-utils.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/utils', () => knowledgeDocumentsUtilsMock)
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)

import { awsSessionSyncContext } from '@/connectors/aws-session'
import { s3Connector } from '@/connectors/s3/s3'

const mockSecureFetchWithRetry = knowledgeSecureFetchMockFns.mockSecureFetchWithRetry

const SESSION = {
  accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  sessionToken: 'IQoJb3JpZ2luX2VjEXAMPLE+token/with=chars',
}

const EMPTY_LISTING =
  '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'

function recordRequests() {
  const requests: { url: string; headers: Record<string, string> }[] = []
  mockSecureFetchWithRetry.mockImplementation(
    async (url: string, init: { headers: Record<string, string> }) => {
      requests.push({ url, headers: init.headers })
      return new Response(EMPTY_LISTING, { status: 200 })
    }
  )
  return requests
}

describe('s3Connector signing', () => {
  beforeEach(() => {
    mockSecureFetchWithRetry.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
  })

  it('signs a saved credential session token into the request, as SigV4 requires', async () => {
    const requests = recordRequests()

    await s3Connector.listDocuments(
      'credential-handle',
      { region: 'us-east-1', bucket: 'docs-bucket', prefix: 'kb/' },
      undefined,
      { ...awsSessionSyncContext(SESSION) }
    )

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.url).toBe(
      'https://docs-bucket.s3.us-east-1.amazonaws.com/?encoding-type=url&list-type=2&max-keys=1000&prefix=kb%2F'
    )
    expect(request.headers['X-Amz-Security-Token']).toBe(SESSION.sessionToken)
    // Reference value from @smithy/signature-v4 (the AWS SDK signer) for the same request.
    expect(request.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=ASIAIOSFODNN7EXAMPLE/20261106/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=dfe6577a8c0c32916977121ba18620aeca7758bf39d0230a02d29183ff49677a'
    )
  })

  it('never sends a saved AWS credential to a custom endpoint', async () => {
    recordRequests()

    const validation = await s3Connector.validateConfig(
      'credential-handle',
      { region: 'us-east-1', bucket: 'docs', endpoint: 'https://attacker.example.com' },
      { ...awsSessionSyncContext(SESSION) }
    )

    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/custom endpoint/i)
    expect(mockSecureFetchWithRetry).not.toHaveBeenCalled()
  })

  it('refuses a non-AWS region with a saved AWS credential', async () => {
    recordRequests()

    const validation = await s3Connector.validateConfig(
      'credential-handle',
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', region: 'auto', bucket: 'docs' },
      { ...awsSessionSyncContext(SESSION) }
    )

    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/AWS region/i)
    expect(mockSecureFetchWithRetry).not.toHaveBeenCalled()
  })

  it.each(['cn-north-1', 'us-iso-east-1', 'eu-isoe-west-1'])(
    'refuses %s, whose S3 host is not under amazonaws.com, with a saved AWS credential',
    async (region) => {
      recordRequests()

      const validation = await s3Connector.validateConfig(
        'credential-handle',
        { region, bucket: 'docs' },
        { ...awsSessionSyncContext(SESSION) }
      )

      expect(validation.valid).toBe(false)
      expect(validation.error).toMatch(/commercial or GovCloud/i)
      expect(mockSecureFetchWithRetry).not.toHaveBeenCalled()
    }
  )

  it('signs a saved AWS credential for a GovCloud bucket', async () => {
    const requests = recordRequests()

    await s3Connector.listDocuments(
      '',
      { region: 'us-gov-west-1', bucket: 'docs-bucket' },
      undefined,
      { ...awsSessionSyncContext(SESSION) }
    )

    expect(requests[0]?.url).toMatch(/^https:\/\/docs-bucket\.s3\.us-gov-west-1\.amazonaws\.com\//)
  })

  it('keeps signing inline keys without a session token', async () => {
    const requests = recordRequests()

    await s3Connector.listDocuments(
      SESSION.secretAccessKey,
      {
        accessKeyId: SESSION.accessKeyId,
        region: 'us-east-1',
        bucket: 'docs-bucket',
        prefix: 'kb/',
      },
      undefined,
      {}
    )

    const [request] = requests
    expect(request.headers['X-Amz-Security-Token']).toBeUndefined()
    // Reference value from @smithy/signature-v4 for the same request without a session token.
    expect(request.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=ASIAIOSFODNN7EXAMPLE/20261106/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=bceba1b42847dc164dfe175c63bc088449c244e6e91cce4ecd6d9b06f6508b0d'
    )
  })

  it('ignores an inline access key ID once a saved credential signs', async () => {
    const requests = recordRequests()

    await s3Connector.getDocument(
      'credential-handle',
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', region: 'us-east-1', bucket: 'docs-bucket' },
      'notes/readme.md',
      { ...awsSessionSyncContext(SESSION) }
    )

    expect(requests[0].headers.Authorization).toContain(
      `Credential=${SESSION.accessKeyId}/20261106/us-east-1/s3/aws4_request`
    )
  })
})
