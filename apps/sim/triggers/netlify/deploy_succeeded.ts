import { NetlifyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNetlifyDeployOutputs,
  buildNetlifyExtraFields,
  netlifySetupInstructions,
  netlifyTriggerOptions,
} from '@/triggers/netlify/utils'
import type { TriggerConfig } from '@/triggers/types'

export const netlifyDeploySucceededTrigger: TriggerConfig = {
  id: 'netlify_deploy_succeeded',
  name: 'Netlify Deploy Succeeded',
  provider: 'netlify',
  description: 'Trigger workflow when a Netlify deploy completes successfully',
  version: '1.0.0',
  icon: NetlifyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'netlify_deploy_succeeded',
    triggerOptions: netlifyTriggerOptions,
    setupInstructions: netlifySetupInstructions('Deploy Succeeded'),
    extraFields: buildNetlifyExtraFields('netlify_deploy_succeeded'),
  }),

  outputs: buildNetlifyDeployOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
