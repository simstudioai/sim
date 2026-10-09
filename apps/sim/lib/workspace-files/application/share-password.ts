import type { Principal } from '@sim/auth/principal'
import { sharePasswordSchema } from '@/lib/api/contracts/public-shares'
import { resolveCopilotSecretReference } from '@/lib/core/application/environment-reference'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseExactEnvironmentReference } from '@/lib/environment/reference'

/**
 * The password to store for a password-gated share.
 *
 * The v2 contract admits a whole-value `{{NAME}}` reference below the share
 * password minimum, because only here is it known whether the caller is Sim's
 * agent: the agent's reference resolves to the variable's value, anyone else's
 * stays literal, and either way the result is held to the share password rules.
 * Other passwords pass through unchanged, with the length rules of the surface
 * that admitted them.
 */
export async function resolveSharePassword(
  principal: Principal,
  workspaceId: string,
  password: string | undefined
): Promise<string | undefined> {
  if (!parseExactEnvironmentReference(password)) return password
  const resolved = await resolveCopilotSecretReference(principal, workspaceId, password, 'password')
  const validated = sharePasswordSchema.safeParse(resolved)
  if (!validated.success) {
    throw new OrchestrationError('validation', validated.error.issues[0].message)
  }
  return validated.data
}
