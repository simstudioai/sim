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
 * Vercel Deployment Canceled Trigger
 */
export const vercelDeploymentCanceledTrigger: TriggerConfig = {
  id: 'vercel_deployment_canceled',
  name: 'Vercel Deployment Canceled',
  provider: 'vercel',
  description: 'Trigger workflow when a deployment is canceled',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_deployment_canceled',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('Deployment Canceled'),
    extraFields: buildVercelExtraFields('vercel_deployment_canceled'),
  }),

  outputs: buildDeploymentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
