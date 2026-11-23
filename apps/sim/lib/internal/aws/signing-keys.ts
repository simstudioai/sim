import type { AwsSessionCredentials } from '@/lib/credentials/aws-service-account.server'

/**
 * The keys that sign a request for a resolved AWS session, without its lifetime:
 * the key pair, plus the session token for an STS session (assumed and keyless
 * roles). Long-lived saved keys have no session token.
 */
export type AwsSigningKeys = Pick<
  AwsSessionCredentials,
  'accessKeyId' | 'secretAccessKey' | 'sessionToken'
>

/** The {@link AwsSigningKeys} of a session, with `sessionToken` left out when it has none. */
export function awsSigningKeys(session: AwsSigningKeys): AwsSigningKeys {
  return {
    accessKeyId: session.accessKeyId,
    secretAccessKey: session.secretAccessKey,
    ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}),
  }
}
