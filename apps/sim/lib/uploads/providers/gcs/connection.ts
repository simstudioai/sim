import type { Storage } from '@google-cloud/storage'
import { env } from '@/lib/core/config/env'

let _gcsClient: Storage | null = null

/**
 * Reset the cached GCS client. Only intended for use in tests.
 */
export function resetGcsClientForTesting(): void {
  _gcsClient = null
}

interface GcsInlineCredentials {
  client_email: string
  private_key: string
  project_id?: string
}

/**
 * Parse the inline service-account JSON from `GCS_CREDENTIALS_JSON`.
 * Returns null when the variable is unset (Application Default Credentials).
 * @throws Error when the variable is set but not valid service-account JSON
 */
export function parseGcsCredentials(): GcsInlineCredentials | null {
  if (!env.GCS_CREDENTIALS_JSON) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(env.GCS_CREDENTIALS_JSON)
  } catch {
    throw new Error('GCS_CREDENTIALS_JSON is not valid JSON')
  }

  const credentials = parsed as Partial<GcsInlineCredentials>
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GCS_CREDENTIALS_JSON must contain client_email and private_key')
  }

  return credentials as GcsInlineCredentials
}

export async function getGcsClient(): Promise<Storage> {
  if (_gcsClient) return _gcsClient

  const { Storage } = await import('@google-cloud/storage')
  const credentials = parseGcsCredentials()

  _gcsClient = new Storage({
    ...(env.GCS_PROJECT_ID || credentials?.project_id
      ? { projectId: env.GCS_PROJECT_ID || credentials?.project_id }
      : {}),
    ...(credentials
      ? {
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key,
          },
        }
      : {}),
  })

  return _gcsClient
}
