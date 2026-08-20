import {
  type V2ChatDeployment,
  v2ChatDeploymentSchema,
} from '@/lib/api/contracts/v2/chat-deployments'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'
import type { ChatDeploymentView } from '@/lib/chat-deployments/application'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'

/**
 * Shared serialization + error mapping for the v2 chat-deployment surface.
 */

/**
 * Projects a chat deployment onto the public shape.
 *
 * The stored `customizations`, `allowedEmails`, and `outputConfigs` are
 * schemaless JSON columns, so a row written before a field existed would fail a
 * strict response parse. They are normalized to their empty values here, which
 * is also what makes the published schema honest about never returning null.
 *
 * The password never reaches this function: `ChatDeploymentView` has already
 * dropped it and replaced it with `hasPassword`.
 */
export function toV2ChatDeployment(
  deployment: ChatDeploymentView,
  workspaceId: string
): V2ChatDeployment {
  return v2ChatDeploymentSchema.parse({
    id: deployment.id,
    workflowId: deployment.workflowId,
    workspaceId,
    identifier: deployment.identifier,
    url: buildChatDeploymentUrl(deployment.identifier),
    title: deployment.title,
    description: deployment.description ?? '',
    isActive: deployment.isActive,
    authType: deployment.authType,
    hasPassword: deployment.hasPassword,
    allowedEmails: deployment.allowedEmails ?? [],
    customizations: deployment.customizations ?? {},
    outputConfigs: deployment.outputConfigs ?? [],
    includeThinking: deployment.includeThinking,
    includeToolCalls: deployment.includeToolCalls ?? false,
    createdAt: deployment.createdAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
  })
}

export const chatDeploymentErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Chat deployment not found',
})
