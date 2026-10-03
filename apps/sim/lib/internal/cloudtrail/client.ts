import { CloudTrailClient } from '@aws-sdk/client-cloudtrail'

export interface CloudTrailConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Attempts allowed for `LookupEvents`, which AWS throttles at two requests per
 * second per account per Region. Paired with adaptive retry mode so the SDK's
 * client-side rate limiter absorbs `ThrottlingException` with exponential
 * backoff and jitter instead of failing the tool run.
 */
const THROTTLE_SENSITIVE_MAX_ATTEMPTS = 6

export interface CreateCloudTrailClientOptions {
  /** Use AWS adaptive retry mode with a raised attempt ceiling. */
  throttleSensitive?: boolean
}

export function createCloudTrailClient(
  config: CloudTrailConnectionConfig,
  options: CreateCloudTrailClientOptions = {}
): CloudTrailClient {
  return new CloudTrailClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(options.throttleSensitive
      ? { retryMode: 'adaptive', maxAttempts: THROTTLE_SENSITIVE_MAX_ATTEMPTS }
      : {}),
  })
}
