import { createLogger } from '@sim/logger'
import { type AWSCredentials, awsCredentialProvider } from '@trigger.dev/sdk/oidc/aws'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AwsCredentials')

interface StaticAwsCredentials {
  accessKeyId: string
  secretAccessKey: string
}

type AwsCredentialsProvider = () => Promise<AWSCredentials>

/**
 * Refresh workload credentials this long before they expire. It must exceed the AWS SDK's own
 * five-minute refresh window, or a client keeps asking for credentials this module still
 * considers fresh.
 */
const REFRESH_BEFORE_EXPIRY_MS = 10 * 60_000

/**
 * At the start of a run, refresh workload credentials that expire within this window. A token can
 * only be minted while an attempt is executing, and work a run leaves behind (the hosted-key
 * metrics flush) still calls AWS after the attempt ends.
 */
const RUN_START_MIN_REMAINING_MS = 30 * 60_000

/**
 * One AWS session for the whole worker process, not one per run. Every run in a deployment
 * assumes the same role, and Sim's AWS clients are process-wide, so a run-named session would
 * attribute later runs' calls to the run that minted it.
 */
const WORKLOAD_ROLE_SESSION_NAME = 'sim-trigger-worker'

let workloadProvider: AwsCredentialsProvider | null = null
let currentWorkloadCredentials: AWSCredentials | null = null
let pendingWorkloadCredentials: Promise<AWSCredentials> | null = null

function getWorkloadProvider(roleArn: string): AwsCredentialsProvider {
  if (!workloadProvider) {
    if (!env.AWS_REGION) {
      throw new Error('TRIGGER_AWS_ROLE_ARN is set but AWS_REGION is not; set both.')
    }
    workloadProvider = awsCredentialProvider({
      roleArn,
      region: env.AWS_REGION,
      roleSessionName: WORKLOAD_ROLE_SESSION_NAME,
    })
  }
  return workloadProvider
}

/**
 * The cached workload credentials while they have more than `minRemainingMs` left, otherwise a
 * fresh exchange. Concurrent callers share one exchange.
 */
function resolveWorkloadCredentials(
  roleArn: string,
  minRemainingMs: number
): Promise<AWSCredentials> {
  const current = currentWorkloadCredentials
  if (current && current.expiration.getTime() - Date.now() > minRemainingMs) {
    return Promise.resolve(current)
  }
  if (!pendingWorkloadCredentials) {
    pendingWorkloadCredentials = getWorkloadProvider(roleArn)()
      .then((credentials) => {
        currentWorkloadCredentials = credentials
        return credentials
      })
      .finally(() => {
        pendingWorkloadCredentials = null
      })
  }
  return pendingWorkloadCredentials
}

/**
 * Credentials for Sim's own AWS clients: file storage (S3), AppConfig, hosted-key metrics and
 * hosted Bedrock. Never for a user's integration, which brings its own keys.
 *
 * - `TRIGGER_AWS_ROLE_ARN` set (deployed Trigger.dev runs): temporary credentials for that role,
 *   exchanged for the run's Trigger.dev workload-identity token. Takes precedence over static
 *   keys, so a failed exchange surfaces instead of silently falling back to a stored key.
 * - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` set: those keys (self-hosted deployments).
 * - Neither: `undefined`, deferring to the AWS default provider chain (the ECS task role).
 */
export function getAwsCredentials(): StaticAwsCredentials | AwsCredentialsProvider | undefined {
  const roleArn = env.TRIGGER_AWS_ROLE_ARN
  if (roleArn) {
    return () => resolveWorkloadCredentials(roleArn, REFRESH_BEFORE_EXPIRY_MS)
  }
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    }
  }
  return undefined
}

/** Whether Sim's own AWS clients have credentials of their own rather than the default chain. */
export function hasExplicitAwsCredentials(): boolean {
  return Boolean(env.TRIGGER_AWS_ROLE_ARN || (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY))
}

/**
 * Refreshes workload credentials at the start of a Trigger.dev run, while a token can be minted,
 * so they outlive the attempt. A no-op outside workload identity. Never throws: a failure is
 * logged here, and the run's first AWS call retries the exchange and fails with the cause.
 */
export async function refreshAwsCredentialsForRun(): Promise<void> {
  const roleArn = env.TRIGGER_AWS_ROLE_ARN
  if (!roleArn) return
  try {
    await resolveWorkloadCredentials(roleArn, RUN_START_MIN_REMAINING_MS)
  } catch (error) {
    logger.error('Could not exchange the workload-identity token for AWS credentials', { error })
  }
}
