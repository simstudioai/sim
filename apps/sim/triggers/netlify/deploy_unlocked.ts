import { NetlifyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNetlifyDeployOutputs,
  buildNetlifyExtraFields,
  netlifySetupInstructions,
  netlifyTriggerOptions,
} from '@/triggers/netlify/utils'
import type { TriggerConfig } from '@/triggers/types'

export const netlifyDeployUnlockedTrigger: TriggerConfig = {
  id: 'netlify_deploy_unlocked',
  name: 'Netlify Deploy Unlocked',
  provider: 'netlify',
  description: 'Trigger workflow when a Netlify deploy is unlocked (auto-publish resumed)',
  version: '1.0.0',
  icon: NetlifyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'netlify_deploy_unlocked',
    triggerOptions: netlifyTriggerOptions,
    setupInstructions: netlifySetupInstructions('Deploy Unlocked'),
    extraFields: buildNetlifyExtraFields('netlify_deploy_unlocked'),
  }),

  outputs: buildNetlifyDeployOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
