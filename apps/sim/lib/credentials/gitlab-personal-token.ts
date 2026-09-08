import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { normalizeGitLabHost } from '@/tools/gitlab/utils'

const gitLabUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1).max(255),
  name: z.string().max(255),
  state: z.literal('active'),
  bot: z.boolean().optional(),
})
const gitLabTokenSchema = z.object({
  user_id: z.number().int().positive(),
  active: z.literal(true),
  revoked: z.literal(false),
  scopes: z.array(z.string().max(100)).min(1).max(100),
  expires_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
})
const tokenEnvelopeSchema = z.object({
  providerId: z.literal('gitlab'),
  ownerUserId: z.string().min(1),
  workspaceId: z.string().min(1),
  subjectId: z.string().min(1),
  instanceUrl: z.string().url(),
  accessToken: z.string().min(1).max(4096),
})
export type PersonalTokenEnvelope = z.output<typeof tokenEnvelopeSchema>

/** Verifies identity and scopes only at the exact HTTPS instance chosen by the person. */
export async function verifyGitLabPersonalToken(accessToken: string, rawHost?: string) {
  let instanceUrl: string
  try {
    instanceUrl = new URL(`https://${normalizeGitLabHost(rawHost)}`).origin
  } catch {
    throw new OrchestrationError('validation', 'Enter a GitLab host such as gitlab.example.com')
  }
  if (!accessToken.trim() || accessToken.length > 4096) {
    throw new OrchestrationError('validation', 'Enter a valid GitLab personal access token')
  }
  async function get(path: string): Promise<unknown> {
    const response = await secureFetchWithValidation(`${instanceUrl}/api/v4/${path}`, {
      profile: 'configuredEndpoint',
      headers: { 'PRIVATE-TOKEN': accessToken, Accept: 'application/json' },
      timeout: 10_000,
      maxResponseBytes: 64 * 1024,
      maxRedirects: 0,
    })
    if (!response.ok) {
      throw new OrchestrationError(
        'validation',
        response.status === 401 || response.status === 403
          ? 'GitLab rejected this token. Check its api scope and expiry.'
          : 'Could not verify this personal token on the selected GitLab instance. Try again.'
      )
    }
    return response.json()
  }
  const user = gitLabUserSchema.safeParse(await get('user'))
  if (!user.success || user.data.bot) {
    throw new OrchestrationError(
      'validation',
      'Use your personal GitLab account token, not a project, group, or bot token'
    )
  }
  const token = gitLabTokenSchema.safeParse(await get('personal_access_tokens/self'))
  if (!token.success || token.data.user_id !== user.data.id || !token.data.scopes.includes('api')) {
    throw new OrchestrationError('validation', 'Create a personal GitLab token with the api scope')
  }
  return {
    providerId: 'gitlab' as const,
    subjectId: String(user.data.id),
    instanceUrl,
    displayName: `${user.data.name || user.data.username} (${new URL(instanceUrl).host})`,
    grantedScopes: token.data.scopes,
    expiresAt: token.data.expires_at ? new Date(`${token.data.expires_at}T00:00:00Z`) : null,
  }
}

/** Encrypts owner and target bindings together with the token to detect mismatched storage. */
export async function encryptPersonalToken(envelope: PersonalTokenEnvelope): Promise<string> {
  return (await encryptSecret(JSON.stringify(tokenEnvelopeSchema.parse(envelope)))).encrypted
}

/** Only the authorized resolver supplies the expected identity and target from canonical storage. */
export async function decryptPersonalToken(
  encrypted: string,
  expected: Omit<PersonalTokenEnvelope, 'accessToken'>
): Promise<string> {
  const { decrypted } = await decryptSecret(encrypted)
  const parsed = tokenEnvelopeSchema.parse(JSON.parse(decrypted))
  for (const key of [
    'providerId',
    'ownerUserId',
    'workspaceId',
    'subjectId',
    'instanceUrl',
  ] as const) {
    if (parsed[key] !== expected[key]) throw new Error('Stored personal token binding is invalid')
  }
  return parsed.accessToken
}
