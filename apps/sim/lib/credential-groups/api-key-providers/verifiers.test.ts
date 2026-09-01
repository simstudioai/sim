/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  awsApiKeyVerifier,
  deriveSigningKey,
  signStsRequest,
} from '@/lib/credential-groups/api-key-providers/aws'
import { firefliesApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/fireflies'
import { grainApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/grain'
import { granolaApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/granola'
import { getCredentialGroupApiKeyVerifier } from '@/lib/credential-groups/api-key-providers/registry'
import {
  CredentialGroupApiKeyVerificationError,
  unprovenApiKeySubjectId,
} from '@/lib/credential-groups/api-key-providers/types'
import { CREDENTIAL_GROUP_API_KEY_PROVIDER_IDS } from '@/lib/credential-groups/providers'

const originalFetch = global.fetch

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  }) as typeof global.fetch
}

describe('credential group API key verifiers', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves a verifier for every registered API-key provider', () => {
    for (const provider of CREDENTIAL_GROUP_API_KEY_PROVIDER_IDS) {
      expect(getCredentialGroupApiKeyVerifier(provider).provider).toBe(provider)
    }
  })

  describe('fireflies', () => {
    it('returns a verified identity from the viewer query', async () => {
      mockFetch({
        json: async () => ({
          data: { user: { user_id: 'u1', name: 'Ada', email: 'Ada@Example.com ' } },
        }),
      })

      await expect(firefliesApiKeyVerifier.verify({ apiKey: 'key' })).resolves.toEqual({
        identity: 'verified',
        subjectId: 'u1',
        displayName: 'Ada',
        email: 'ada@example.com',
      })
    })

    it('rejects an unauthorized key', async () => {
      mockFetch({ ok: false, status: 401 })
      await expect(firefliesApiKeyVerifier.verify({ apiKey: 'key' })).rejects.toThrow(
        CredentialGroupApiKeyVerificationError
      )
    })

    /** GraphQL reports auth failures in a 200 body, so status alone is not enough. */
    it('rejects a 200 response carrying GraphQL errors', async () => {
      mockFetch({ json: async () => ({ errors: [{ message: 'Unauthorized' }] }) })
      await expect(firefliesApiKeyVerifier.verify({ apiKey: 'key' })).rejects.toThrow(
        CredentialGroupApiKeyVerificationError
      )
    })

    it('rejects a viewer without an email rather than downgrading to unproven', async () => {
      mockFetch({ json: async () => ({ data: { user: { user_id: 'u1', name: 'Ada' } } }) })
      await expect(firefliesApiKeyVerifier.verify({ apiKey: 'key' })).rejects.toThrow(
        CredentialGroupApiKeyVerificationError
      )
    })
  })

  describe.each([
    ['grain', grainApiKeyVerifier],
    ['granola', granolaApiKeyVerifier],
  ])('%s', (_name, verifier) => {
    it('reports an unproven identity keyed to the credential itself', async () => {
      mockFetch({ json: async () => ({ data: [] }) })

      const result = await verifier.verify({ apiKey: 'some-api-key' })

      expect(result.identity).toBe('unproven')
      expect(result.subjectId).toBe(unprovenApiKeySubjectId({ apiKey: 'some-api-key' }))
      expect(result).not.toHaveProperty('email')
    })

    it('gives a different subject when the key rotates', async () => {
      mockFetch({ json: async () => ({}) })
      const first = await verifier.verify({ apiKey: 'key-one' })
      const second = await verifier.verify({ apiKey: 'key-two' })
      expect(first.subjectId).not.toBe(second.subjectId)
    })

    it('rejects a forbidden key', async () => {
      mockFetch({ ok: false, status: 403 })
      await expect(verifier.verify({ apiKey: 'key' })).rejects.toThrow(
        CredentialGroupApiKeyVerificationError
      )
    })

    it('rejects a transport failure without leaking the cause', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof global.fetch
      await expect(verifier.verify({ apiKey: 'key' })).rejects.toThrow(
        CredentialGroupApiKeyVerificationError
      )
    })
  })

  it('never puts a credential value in the subject identifier', () => {
    const subject = unprovenApiKeySubjectId({ apiKey: 'sk-secret', other: 'v-secret' })
    expect(subject).not.toContain('sk-secret')
    expect(subject).not.toContain('v-secret')
    expect(subject).toMatch(/^unproven:[0-9a-f]{64}$/)
  })

  it('is insensitive to field insertion order', () => {
    expect(unprovenApiKeySubjectId({ a: '1', b: '2' })).toBe(
      unprovenApiKeySubjectId({ b: '2', a: '1' })
    )
  })

  describe('aws', () => {
    const credentials = {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    }

    /**
     * AWS's own published derivation vector. This is the only independently-known-correct
     * value available for this file, and it is what makes the golden signature below
     * meaningful rather than merely self-consistent.
     */
    it('derives the signing key AWS documents for its worked example', () => {
      expect(
        deriveSigningKey(
          'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
          '20150830',
          'us-east-1',
          'iam'
        ).toString('hex')
      ).toBe('c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9')
    })

    /**
     * Pins the whole header for fixed inputs. A shape assertion cannot do this job: a wrong
     * signature is still 64 hex characters, so reordering the HMAC chain, changing the
     * credential scope, or altering the canonical request would all pass unnoticed and surface
     * only as AWS rejecting a valid key in production.
     */
    it('produces a stable signature for fixed credentials and timestamp', () => {
      expect(
        signStsRequest(
          'AKIAIOSFODNN7EXAMPLE',
          'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
          '20150830T123600Z'
        )
      ).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20150830/us-east-1/sts/aws4_request, ' +
          'SignedHeaders=content-type;host;x-amz-date, ' +
          'Signature=6fb20d31f734d876c5682fdd2678d194cf68b862755f83b7ba1373c0874be25c'
      )
    })

    it('sends the signed GetCallerIdentity request and reports an unproven identity', async () => {
      mockFetch({ text: async () => '<GetCallerIdentityResponse/>' })

      const result = await awsApiKeyVerifier.verify(credentials)

      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(url).toBe('https://sts.amazonaws.com/')
      expect(init.body).toBe('Action=GetCallerIdentity&Version=2011-06-15')
      expect(init.headers.Authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/sts\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/
      )
      expect(init.headers['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/)
      expect(result.identity).toBe('unproven')
      expect(result.subjectId).toBe(unprovenApiKeySubjectId(credentials))
    })

    it('rejects a malformed region before making a request', async () => {
      mockFetch({})
      await expect(
        awsApiKeyVerifier.verify({ ...credentials, region: 'US East (N. Virginia)' })
      ).rejects.toThrow(/Region must look like/)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('rejects credentials AWS refuses', async () => {
      mockFetch({ ok: false, status: 403 })
      await expect(awsApiKeyVerifier.verify(credentials)).rejects.toThrow(
        CredentialGroupApiKeyVerificationError
      )
    })

    /** The region is stored for the tools that consume it, not folded into signing. */
    it('changes subject when only the region changes', async () => {
      mockFetch({})
      const base = await awsApiKeyVerifier.verify(credentials)
      const other = await awsApiKeyVerifier.verify({ ...credentials, region: 'eu-west-1' })
      expect(other.subjectId).not.toBe(base.subjectId)
    })
  })
})
