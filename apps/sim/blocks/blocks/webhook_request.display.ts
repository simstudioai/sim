import { WebhookIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const WebhookRequestBlockDisplay = {
  type: 'webhook_request',
  name: 'Outgoing Webhook',
  description: 'Send a webhook request',
  category: 'blocks',
  bgColor: '#10B981',
  icon: WebhookIcon,
  longDescription:
    'Send an HTTP POST request to a webhook URL with automatic webhook headers. Optionally sign the payload with HMAC-SHA256 for secure webhook delivery.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/webhook',
} satisfies BlockDisplay
