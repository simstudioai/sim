import { type ComponentType, useMemo } from 'react'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isViableFallbackModel } from '@/lib/workflows/blocks/fallback-models'
import { getModelOptions } from '@/blocks/utils'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useProvidersStore } from '@/stores/providers/store'

/** A model a fallback row may pick, with its provider's mark when the catalog has one. */
export interface FallbackModelOption {
  label: string
  value: string
  icon?: ComponentType<{ className?: string }>
}

/**
 * The models a fallback row of `primaryModel` can name: usable under the viewer's permission group
 * and able to run with the credentials the block can give them.
 *
 * `getModelOptions` reads the providers store itself; subscribing to `providers` here is what
 * recomputes the list when a dynamic provider's models finish loading, and the deployment shape
 * decides which hosted models are offered.
 */
export function useFallbackModelOptions(primaryModel: string): FallbackModelOption[] {
  const { isModelUsable } = usePermissionConfig()
  const deploymentShape = useDeploymentShape()
  const providers = useProvidersStore((state) => state.providers)
  return useMemo(
    () =>
      getModelOptions()
        .filter(
          (option) => isModelUsable(option.id) && isViableFallbackModel(option.id, primaryModel)
        )
        .map((option) => ({
          label: option.label,
          value: option.id,
          ...(option.icon ? { icon: option.icon } : {}),
        })),
    [primaryModel, isModelUsable, providers, deploymentShape]
  )
}
