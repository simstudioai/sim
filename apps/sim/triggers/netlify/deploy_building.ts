import { NetlifyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildNetlifyDeployOutputs,
  buildNetlifyExtraFields,
  netlifySetupInstructions,
  netlifyTriggerOptions,
} from '@/triggers/netlify/utils'
import type { TriggerConfig } from '@/triggers/types'

export const netlifyDeployBuildingTrigger: TriggerConfig = {
  id: 'netlify_deploy_building',
  name: 'Netlify Deploy Building',
  provider: 'netlify',
  description: 'Trigger workflow when Netlify starts building a deploy',
  version: '1.0.0',
  icon: NetlifyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'netlify_deploy_building',
    triggerOptions: netlifyTriggerOptions,
    setupInstructions: netlifySetupInstructions('Deploy Building'),
    extraFields: buildNetlifyExtraFields('netlify_deploy_building'),
  }),

  outputs: buildNetlifyDeployOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
