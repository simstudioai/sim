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
 * Vercel Deployment Created Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 */
export const vercelDeploymentCreatedTrigger: TriggerConfig = {
  id: 'vercel_deployment_created',
  name: 'Vercel Deployment Created',
  provider: 'vercel',
  description: 'Trigger workflow when a new deployment is created',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_deployment_created',
    triggerOptions: vercelTriggerOptions,
    includeDropdown: true,
    setupInstructions: vercelSetupInstructions('Deployment Created'),
    extraFields: buildVercelExtraFields('vercel_deployment_created'),
  }),

  outputs: buildDeploymentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
