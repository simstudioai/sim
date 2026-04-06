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
 * Vercel Deployment Error Trigger
 */
export const vercelDeploymentErrorTrigger: TriggerConfig = {
  id: 'vercel_deployment_error',
  name: 'Vercel Deployment Error',
  provider: 'vercel',
  description: 'Trigger workflow when a deployment fails',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_deployment_error',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('Deployment Error'),
    extraFields: buildVercelExtraFields('vercel_deployment_error'),
  }),

  outputs: buildDeploymentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
