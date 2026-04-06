import { VercelIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildDomainOutputs,
  buildVercelExtraFields,
  vercelSetupInstructions,
  vercelTriggerOptions,
} from '@/triggers/vercel/utils'

/**
 * Vercel Domain Created Trigger
 */
export const vercelDomainCreatedTrigger: TriggerConfig = {
  id: 'vercel_domain_created',
  name: 'Vercel Domain Created',
  provider: 'vercel',
  description: 'Trigger workflow when a domain is created',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_domain_created',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('Domain Created'),
    extraFields: buildVercelExtraFields('vercel_domain_created'),
  }),

  outputs: buildDomainOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
