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
 * Vercel Project Removed Trigger
 */
export const vercelProjectRemovedTrigger: TriggerConfig = {
  id: 'vercel_project_removed',
  name: 'Vercel Project Removed',
  provider: 'vercel',
  description: 'Trigger workflow when a project is removed',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_project_removed',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('Project Removed'),
    extraFields: buildVercelExtraFields('vercel_project_removed'),
  }),

  outputs: buildProjectOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
