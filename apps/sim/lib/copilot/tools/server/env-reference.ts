import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/**
 * Resolves a whole-value `{{ENV_VAR}}` reference in a secret-bearing tool arg.
 *
 * Copilot agents never see secret values — the workspace exposes variable
 * NAMES only — so when a user says "use the password in CHAT_PW" the model
 * passes `{{CHAT_PW}}`. Without resolution the literal seven-character
 * placeholder becomes the stored secret and nothing ever errors. Only the
 * explicit braced form resolves here: unlike API keys, passwords are
 * free-form strings, so `$NAME`/bare-name heuristics would corrupt real ones.
 *
 * Returns an error when the referenced variable is unset so the model learns
 * the actual fix instead of silently storing the placeholder.
 */
export async function resolveEnvReferenceSecretArg(args: {
  userId: string
  workspaceId?: string
  value: string | undefined
  argName: string
  registry?: ResolvedSecretTraceRegistry
}): Promise<{ value?: string; error?: string }> {
  const { value } = args
  if (!value) return { value }
  const braced = value.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/)
  if (!braced) return { value }
  const name = braced[1]
  const env = await getEffectiveDecryptedEnv(args.userId, args.workspaceId)
  const resolved = env[name]
  if (resolved === undefined || resolved === '') {
    return {
      error: `Environment variable "${name}" referenced by ${args.argName} is not set for this workspace or user. Set it first, or pass the raw value.`,
    }
  }
  // Activate on the call's egress registry so an accidental echo is redacted.
  args.registry?.recordResolved(name, resolved)
  return { value: resolved }
}
