import {
  V2_CHAT_DEPLOYMENT_CUSTOMIZATION_KEYS,
  type V2ChatDeployment,
  type V2ChatDeploymentListItem,
  v2ChatDeploymentListItemSchema,
  v2ChatDeploymentSchema,
} from '@/lib/api/contracts/v2/chat-deployments'
import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes'
import type { ChatDeploymentView } from '@/lib/chat-deployments/application'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'

/**
 * Shared serialization + error mapping for the v2 chat-deployment surface.
 */

type V2ChatDeploymentCustomizations = V2ChatDeployment['customizations']
type V2ChatDeploymentOutputConfig = V2ChatDeployment['outputConfigs'][number]

/**
 * The customizations a stored blob may contribute to a read.
 *
 * `chat.customizations` is schemaless JSONB with several writers — the internal
 * editor declares `logoUrl` and `headerText` that this surface does not, and the
 * Copilot deploy tool stores whatever it is handed. Spreading the blob into a
 * parse published those keys, and once the shape was tightened it failed the
 * response parse instead, turning a legitimate row into a `500` on the detail
 * read and on every list page it appeared in. Projecting onto the declared keys
 * makes the read canonical by construction.
 */
function normalizeStoredCustomizations(raw: unknown): V2ChatDeploymentCustomizations {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const key of V2_CHAT_DEPLOYMENT_CUSTOMIZATION_KEYS) {
    const value = source[key]
    if (typeof value === 'string') picked[key] = value
  }
  return picked
}

/**
 * The output configs a stored blob may contribute to a read.
 *
 * Same JSONB reasoning as {@link normalizeStoredCustomizations}: the create path
 * accepts an entry with an empty `path` and with keys beyond `blockId`/`path`,
 * so an entry is projected rather than parsed. An entry naming no block is
 * unusable to a caller and is dropped.
 */
function normalizeStoredOutputConfigs(raw: unknown): V2ChatDeploymentOutputConfig[] {
  if (!Array.isArray(raw)) return []
  const configs: V2ChatDeploymentOutputConfig[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const { workflowId, blockId, path } = entry as Record<string, unknown>
    if (typeof blockId !== 'string' || blockId.length === 0) continue
    configs.push({
      ...(typeof workflowId === 'string' && workflowId.length > 0 ? { workflowId } : {}),
      blockId,
      path: typeof path === 'string' ? path : '',
    })
  }
  return configs
}

/** The allow-list a stored blob may contribute to a read. */
function normalizeStoredAllowedEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Projects a chat deployment onto the public shape.
 *
 * The stored `customizations`, `allowedEmails`, and `outputConfigs` are
 * schemaless JSON columns, so a row carrying a key or a value the published
 * shape does not declare would fail the response parse. Each is projected onto
 * the declared shape here, which is also what makes the published schema honest
 * about never returning null.
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
    allowedEmails: normalizeStoredAllowedEmails(deployment.allowedEmails),
    customizations: normalizeStoredCustomizations(deployment.customizations),
    outputConfigs: normalizeStoredOutputConfigs(deployment.outputConfigs),
    includeThinking: deployment.includeThinking,
    includeToolCalls: deployment.includeToolCalls ?? false,
    createdAt: deployment.createdAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
  })
}

/**
 * Projects a chat deployment onto the list shape.
 *
 * Serialized field by field rather than by stripping the detail shape, so a
 * field added to `V2ChatDeployment` cannot reach the workspace-wide list by
 * default — the same reason `toV2Credential` enumerates rather than spreads a
 * row. `allowedEmails`, `hasPassword`, and `customizations` are deliberately
 * absent: they are gated behind the admin-only detail read.
 */
export function toV2ChatDeploymentListItem(
  deployment: ChatDeploymentView,
  workspaceId: string
): V2ChatDeploymentListItem {
  return v2ChatDeploymentListItemSchema.parse({
    id: deployment.id,
    workflowId: deployment.workflowId,
    workspaceId,
    identifier: deployment.identifier,
    url: buildChatDeploymentUrl(deployment.identifier),
    title: deployment.title,
    description: deployment.description ?? '',
    isActive: deployment.isActive,
    authType: deployment.authType,
    outputConfigs: normalizeStoredOutputConfigs(deployment.outputConfigs),
    includeThinking: deployment.includeThinking,
    includeToolCalls: deployment.includeToolCalls ?? false,
    createdAt: deployment.createdAt.toISOString(),
    updatedAt: deployment.updatedAt.toISOString(),
  })
}

export const chatDeploymentErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Chat deployment not found',
})

/**
 * The list is addressed by workspace, not by deployment, so a concealed
 * cross-tenant denial must name the workspace the caller asked for. Concealment
 * itself is unchanged — an unreachable workspace still answers 404 whether or
 * not it holds any deployment.
 */
export const chatDeploymentWorkspaceErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
})
