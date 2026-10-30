import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { withAllowlistRows } from '@/ee/access-control/utils/integration-allowlist-rows'
import {
  type AccessRequestCatalog,
  type AccessRequestTarget,
  getAccessRequestTargetKey,
  type PermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'

/** Changes only the selected row; parent changes preserve every child's saved choice. */
export function withPermissionGroupAccessState(
  config: PermissionGroupConfig,
  target: AccessRequestTarget,
  state: PermissionGroupAccessState,
  catalog: AccessRequestCatalog
): PermissionGroupConfig {
  const next = { ...config }
  const allowed = state === 'allowed'
  const setMember = <T extends string>(stored: T[] | null, universe: T[], id: T): T[] | null => {
    const members = new Set(stored ?? universe)
    if (allowed) members.add(id)
    else members.delete(id)
    return universe.every((value) => members.has(value)) ? null : [...members]
  }
  switch (target.kind) {
    case 'feature':
      next[target.configKey] = !allowed
      break
    case 'integration':
      next.allowedIntegrations = withAllowlistRows(
        [...catalog.integrations.keys()],
        config.allowedIntegrations,
        [target.id],
        allowed
      )
      break
    case 'provider':
      next.allowedModelProviders = setMember(
        config.allowedModelProviders,
        [...catalog.providers.keys()],
        target.id
      )
      break
    case 'model': {
      next.deniedModels = config.deniedModels.filter(
        (id) => id.toLowerCase() !== target.id.toLowerCase()
      )
      if (!allowed) next.deniedModels.push(target.id)
      break
    }
    case 'tool':
      next.deniedTools = config.deniedTools.filter((id) => id !== target.id)
      if (!allowed) next.deniedTools.push(target.id)
      break
    case 'knowledge_connector':
      next.allowedKnowledgeConnectors = setMember(
        config.allowedKnowledgeConnectors,
        [...catalog.knowledgeConnectors.keys()],
        target.id
      )
      break
    case 'file_share_auth':
      next.allowedFileShareAuthTypes = setMember(
        config.allowedFileShareAuthTypes,
        ['public', 'password', 'email', 'sso'],
        target.id
      )
      break
    case 'chat_deploy_auth':
      next.allowedChatDeployAuthTypes = setMember(
        config.allowedChatDeployAuthTypes,
        ['public', 'password', 'email', 'sso'],
        target.id
      )
      break
    case 'usage_limit':
      return config
  }
  const key = getAccessRequestTargetKey(target)
  next.deniedAccessRequests = config.deniedAccessRequests.filter((value) => value !== key)
  if (state === 'unavailable') next.deniedAccessRequests.push(key)
  return next
}
