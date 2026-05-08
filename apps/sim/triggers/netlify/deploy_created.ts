import { NetlifyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNetlifyDeployOutputs,
  buildNetlifyExtraFields,
  netlifySetupInstructions,
  netlifyTriggerOptions,
} from '@/triggers/netlify/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Primary Netlify trigger — includes the dropdown for picking which event to listen for.
 */
export const netlifyDeployCreatedTrigger: TriggerConfig = {
  id: 'netlify_deploy_created',
  name: 'Netlify Deploy Created',
  provider: 'netlify',
  description: 'Trigger workflow when a new Netlify deploy is created (build queued)',
  version: '1.0.0',
  icon: NetlifyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'netlify_deploy_created',
    triggerOptions: netlifyTriggerOptions,
    includeDropdown: true,
    setupInstructions: netlifySetupInstructions('Deploy Created'),
    extraFields: buildNetlifyExtraFields('netlify_deploy_created'),
  }),

  outputs: buildNetlifyDeployOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
