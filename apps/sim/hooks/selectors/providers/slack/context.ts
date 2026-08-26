import { isReference } from '@/executor/constants'
import type { SelectorContext } from '@/hooks/selectors/types'

/** Maps legacy Slack auth fields onto the shared selector credential context. */
export function transformSlackSelectorContext(
  context: SelectorContext,
  dependencies: Record<string, unknown>
): SelectorContext {
  const authMethod = dependencies.authMethod as string
  const oauthCredential =
    authMethod === 'bot_token'
      ? String(dependencies.botToken ?? '')
      : String(dependencies.credential ?? dependencies.customBotCredential ?? '')
  return {
    ...context,
    oauthCredential: isReference(oauthCredential) ? undefined : oauthCredential,
  }
}
