import { NetlifyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNetlifyDeployOutputs,
  buildNetlifyExtraFields,
  netlifySetupInstructions,
  netlifyTriggerOptions,
} from '@/triggers/netlify/utils'
import type { TriggerConfig } from '@/triggers/types'

export const netlifyDeployLockedTrigger: TriggerConfig = {
  id: 'netlify_deploy_locked',
  name: 'Netlify Deploy Locked',
  provider: 'netlify',
  description: 'Trigger workflow when a Netlify deploy is locked to a published version',
  version: '1.0.0',
  icon: NetlifyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'netlify_deploy_locked',
    triggerOptions: netlifyTriggerOptions,
    setupInstructions: netlifySetupInstructions('Deploy Locked'),
    extraFields: buildNetlifyExtraFields('netlify_deploy_locked'),
  }),

  outputs: buildNetlifyDeployOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
