import { VercelIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildVercelExtraFields,
  buildVercelOutputs,
  vercelSetupInstructions,
  vercelTriggerOptions,
} from '@/triggers/vercel/utils'

/**
 * Vercel webhook trigger for a curated bundle of frequent event types.
 * Vercel requires an explicit event list; this is not every event in their catalog.
 */
export const vercelWebhookTrigger: TriggerConfig = {
  id: 'vercel_webhook',
  name: 'Vercel Webhook (Common Events)',
  provider: 'vercel',
  description:
    'Trigger on a curated set of common Vercel events (deployments, projects, domains, edge config). Pick a specific trigger to listen to one event type only.',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_webhook',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions(
      'common deployment, project, domain, and edge-config events'
    ),
    extraFields: buildVercelExtraFields('vercel_webhook'),
  }),

  outputs: buildVercelOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
