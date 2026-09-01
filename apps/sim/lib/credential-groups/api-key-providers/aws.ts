import { createHash, createHmac } from 'node:crypto'
import {
  type CredentialGroupApiKeyVerification,
  CredentialGroupApiKeyVerificationError,
  type CredentialGroupApiKeyVerifier,
  unprovenApiKeySubjectId,
} from '@/lib/credential-groups/api-key-providers/types'

/**
 * `sts:GetCallerIdentity` requires no IAM permission at all, so it validates a key pair
 * however narrowly its policy is scoped — any other call would reject a perfectly good
 * credential that simply lacks that one permission.
 *
 * STS is global and always reachable at this endpoint, so the region the person supplied is
 * not used for signing here. It is stored because the tools that consume the credential need
 * it, not because verification does.
 */
const STS_HOST = 'sts.amazonaws.com'
const STS_REGION = 'us-east-1'
const STS_SERVICE = 'sts'
const STS_BODY = 'Action=GetCallerIdentity&Version=2011-06-15'

const AWS_REGION_PATTERN = /^[a-z0-9-]{1,32}$/

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/**
 * The SigV4 four-step key derivation. Exported because it is the one part of this file with a
 * published AWS test vector, and pinning it is what keeps a reordered HMAC chain from failing
 * silently — a wrong signature is still 64 hex characters, so only a known-good value catches it.
 */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    'aws4_request'
  )
}

/**
 * Minimal SigV4 for one fixed request.
 *
 * Written out rather than shared with `tools/s3`, which hand-rolls the same algorithm: `lib/`
 * cannot import the tool registry (the realtime prune graph forbids it), and this covers only
 * the simplest possible case — one POST, no query string, three headers.
 */
export function signStsRequest(
  accessKeyId: string,
  secretAccessKey: string,
  amzDate: string
): string {
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = createHash('sha256').update(STS_BODY, 'utf8').digest('hex')
  const canonicalHeaders =
    `content-type:application/x-www-form-urlencoded; charset=utf-8\n` +
    `host:${STS_HOST}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const credentialScope = `${dateStamp}/${STS_REGION}/${STS_SERVICE}/aws4_request`
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n` +
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')

  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, STS_REGION, STS_SERVICE)
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export const awsApiKeyVerifier: CredentialGroupApiKeyVerifier = {
  provider: 'aws',
  async verify(fields: Record<string, string>): Promise<CredentialGroupApiKeyVerification> {
    if (!AWS_REGION_PATTERN.test(fields.region)) {
      throw new CredentialGroupApiKeyVerificationError('Region must look like us-east-1.')
    }

    const amzDate = `${new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')}`
    let response: Response
    try {
      response = await fetch(`https://${STS_HOST}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'X-Amz-Date': amzDate,
          Authorization: signStsRequest(fields.accessKeyId, fields.secretAccessKey, amzDate),
        },
        body: STS_BODY,
      })
    } catch {
      throw new CredentialGroupApiKeyVerificationError(
        'Could not reach AWS to check these credentials. Please try again.'
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new CredentialGroupApiKeyVerificationError(
        'AWS rejected this access key ID and secret.'
      )
    }
    if (!response.ok) {
      throw new CredentialGroupApiKeyVerificationError(
        'AWS could not verify these credentials right now. Please try again.'
      )
    }

    /**
     * GetCallerIdentity does return a real caller ARN, but it carries no address to match
     * against the invitation, so the binding is recorded as unproven and keyed to the
     * credential itself like every other provider that cannot name its owner.
     */
    return {
      identity: 'unproven',
      subjectId: unprovenApiKeySubjectId(fields),
      displayName: 'AWS account',
    }
  },
}
