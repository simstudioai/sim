import { NetlifyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNetlifyDeployOutputs,
  buildNetlifyExtraFields,
  netlifySetupInstructions,
  netlifyTriggerOptions,
} from '@/triggers/netlify/utils'
import type { TriggerConfig } from '@/triggers/types'

export const netlifyDeployFailedTrigger: TriggerConfig = {
  id: 'netlify_deploy_failed',
  name: 'Netlify Deploy Failed',
  provider: 'netlify',
  description: 'Trigger workflow when a Netlify deploy fails',
  version: '1.0.0',
  icon: NetlifyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'netlify_deploy_failed',
    triggerOptions: netlifyTriggerOptions,
    setupInstructions: netlifySetupInstructions('Deploy Failed'),
    extraFields: buildNetlifyExtraFields('netlify_deploy_failed'),
  }),

  outputs: buildNetlifyDeployOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
