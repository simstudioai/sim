import { EC2Client, type Tag } from '@aws-sdk/client-ec2'

interface Ec2ConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function createEc2Client(
  config: Ec2ConnectionConfig,
  options?: { maxAttempts?: number }
): EC2Client {
  return new EC2Client({
    region: config.region,
    ...(options?.maxAttempts !== undefined && { maxAttempts: options.maxAttempts }),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

/** Normalizes an SDK `Date` field to an ISO-8601 string so it survives JSON transport. */
export function toIsoString(value?: Date): string | null {
  return value ? value.toISOString() : null
}

/** Flattens EC2's `[{ Key, Value }]` tag list into a plain `{ key: value }` record. */
export function tagsToRecord(tags?: Tag[]): Record<string, string> {
  return Object.fromEntries(
    (tags ?? []).flatMap((tag) => (tag.Key ? [[tag.Key, tag.Value ?? '']] : []))
  )
}

export function recordToTags(tags: Record<string, string>): Tag[] {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }))
}
