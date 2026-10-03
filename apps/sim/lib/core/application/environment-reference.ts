import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { parseExactEnvironmentReference } from '@/lib/environment/reference'
import { resolveEffectiveEnvironmentVariables } from '@/lib/environment/utils'

/**
 * Resolves one environment variable for the principal's subject user through a
 * fresh ACL-aware lookup (workspace values override personal ones).
 *
 * Returns `undefined` when the variable is unset, inaccessible, undecryptable, or
 * empty, so callers phrase their own refusal. Throws `forbidden` for a principal
 * with no subject user, which has no personal or member-scoped environment.
 */
export async function resolvePrincipalEnvironmentVariable(
  principal: Principal,
  workspaceId: string | undefined,
  name: string
): Promise<string | undefined> {
  const userId = resolvePrincipalSubjectUserId(principal)
  if (!userId) {
    throw new OrchestrationError('forbidden', 'Secret references require a user identity')
  }
  const variables = await resolveEffectiveEnvironmentVariables(userId, workspaceId, [name])
  const value = Object.hasOwn(variables, name) ? variables[name].value : undefined
  return value || undefined
}

/**
 * Resolves a whole-value `{{NAME}}` secret argument sent by Sim's agent.
 *
 * The agent never sees secret values — the workspace exposes variable names
 * only — so "use the password in CHAT_PW" arrives as the literal `{{CHAT_PW}}`,
 * and storing it verbatim would make the placeholder the real secret. Only the
 * explicit braced form resolves: passwords are free-form strings, so a looser
 * heuristic would corrupt real ones. Every other principal keeps literal
 * semantics, since a public API caller already holds the value it means.
 *
 * Returns the resolved value, or `value` unchanged when it is not a reference or
 * the caller is not a Copilot workspace invocation. An unset or empty variable is
 * a `validation` error naming it, so the agent learns the actual fix instead of
 * silently storing the placeholder.
 */
export async function resolveCopilotSecretReference(
  principal: Principal,
  workspaceId: string,
  value: string | undefined,
  argName: string
): Promise<string | undefined> {
  if (principal.kind !== 'delegated' || !isCopilotWorkspaceInvocation(principal)) return value
  const name = parseExactEnvironmentReference(value)
  if (!name) return value
  const resolved = await resolvePrincipalEnvironmentVariable(principal, workspaceId, name)
  if (resolved === undefined) {
    throw new OrchestrationError(
      'validation',
      `Environment variable "${name}" referenced by ${argName} is not set for this workspace or user. Set it first, or pass the raw value.`
    )
  }
  return resolved
}
