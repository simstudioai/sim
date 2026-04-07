import { VercelIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildProjectOutputs,
  buildVercelExtraFields,
  vercelSetupInstructions,
  vercelTriggerOptions,
} from '@/triggers/vercel/utils'

/**
 * Vercel Project Created Trigger
 */
export const vercelProjectCreatedTrigger: TriggerConfig = {
  id: 'vercel_project_created',
  name: 'Vercel Project Created',
  provider: 'vercel',
  description: 'Trigger workflow when a new project is created',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_project_created',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('Project Created'),
    extraFields: buildVercelExtraFields('vercel_project_created'),
  }),

  outputs: buildProjectOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
