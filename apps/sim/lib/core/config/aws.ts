import { env } from '@/lib/core/config/env'

interface AwsCredentials {
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Explicit AWS credentials from the environment, or `undefined` to defer to the
 * default AWS provider chain (the ECS task role in our deployments).
 *
 * Shared by every AWS SDK client (S3, AppConfig, …) so credential resolution is
 * identical everywhere: explicit keys when both `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` are set (self-hosted, trigger.dev workers), otherwise
 * the instance/task role.
 */
export function getAwsCredentialsFromEnv(): AwsCredentials | undefined {
  return env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined
}
