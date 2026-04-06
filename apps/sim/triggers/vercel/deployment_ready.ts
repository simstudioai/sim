import { VercelIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildDeploymentOutputs,
  buildVercelExtraFields,
  vercelSetupInstructions,
  vercelTriggerOptions,
} from '@/triggers/vercel/utils'

/**
 * Vercel Deployment Ready Trigger
 */
export const vercelDeploymentReadyTrigger: TriggerConfig = {
  id: 'vercel_deployment_ready',
  name: 'Vercel Deployment Ready',
  provider: 'vercel',
  description: 'Trigger workflow when a deployment is ready to serve traffic',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_deployment_ready',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('Deployment Ready'),
    extraFields: buildVercelExtraFields('vercel_deployment_ready'),
  }),

  outputs: buildDeploymentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
