import type { ToolConfig } from '@/tools/types'

/**
 * Recognizes Slack's existing dual-auth declaration without loading its executable tools.
 * OAuth-only Slack tools do not declare these caller-supplied parameters.
 */
export function supportsSlackBotToken(tool: Pick<ToolConfig, 'oauth' | 'params'>): boolean {
  return (
    tool.oauth?.provider === 'slack' &&
    tool.params.authMethod?.type === 'string' &&
    tool.params.authMethod.visibility === 'user-only' &&
    tool.params.botToken?.type === 'string' &&
    tool.params.botToken.visibility === 'user-only'
  )
}
