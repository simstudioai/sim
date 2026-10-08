import { isHosted } from '@/lib/core/config/env-flags'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { resolveAgentDefaultModel } from '@/lib/permission-groups/model-access'
import { findProviderFromModel } from '@/providers/models'
import { filterBlacklistedModels, isProviderBlacklisted } from '@/providers/utils'

/** Resolves the group's default against the current deployment's provider and model policy. */
export function resolveAvailableAgentDefaultModel(
  config: PermissionGroupConfig | null | undefined
) {
  const model = resolveAgentDefaultModel(config, { allowAuto: isHosted })
  if (!model) return null
  const provider = findProviderFromModel(model)
  const modelIds = provider === 'ollama' ? [model, model.replace(/^ollama\//i, '')] : [model]
  return (!provider || !isProviderBlacklisted(provider)) &&
    filterBlacklistedModels(modelIds).length === modelIds.length
    ? model
    : null
}
