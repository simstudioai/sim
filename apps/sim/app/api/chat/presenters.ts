import type { ChatDetail } from '@/lib/api/contracts/deployments'
import type { ChatDeploymentView } from '@/lib/chat-deployments/application'

/**
 * Projects a chat deployment onto the internal editor's detail shape.
 *
 * The stored `customizations`, `allowedEmails`, and `outputConfigs` are
 * schemaless JSON columns, so their defaults are applied here rather than
 * assumed: a row written before a field existed reads as its empty value
 * instead of `null` reaching the client.
 */
export function toChatDetailResponse(deployment: ChatDeploymentView, chatUrl: string): ChatDetail {
  return {
    id: deployment.id,
    identifier: deployment.identifier,
    title: deployment.title,
    description: deployment.description ?? '',
    authType: deployment.authType as ChatDetail['authType'],
    allowedEmails: (deployment.allowedEmails as string[] | null) ?? [],
    outputConfigs: (deployment.outputConfigs as ChatDetail['outputConfigs'] | null) ?? [],
    includeThinking: deployment.includeThinking,
    includeToolCalls: deployment.includeToolCalls ?? false,
    customizations: (deployment.customizations as ChatDetail['customizations']) ?? undefined,
    isActive: deployment.isActive,
    chatUrl,
    hasPassword: deployment.hasPassword,
  }
}
