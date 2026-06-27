import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Webhook } from 'lucide-react'
import type { BlockDisplay } from '@/blocks/manifest'

const WebhookIcon = (props: SVGProps<SVGSVGElement>) => createElement(Webhook, props)

export const GenericWebhookBlockDisplay = {
  type: 'generic_webhook',
  name: 'Webhook',
  description: 'Receive webhooks from any service by configuring a custom webhook.',
  category: 'triggers',
  bgColor: '#10B981',
  icon: WebhookIcon,
  docsLink: 'https://docs.sim.ai/workflows/triggers/webhook',
  triggerAllowed: true,
} satisfies BlockDisplay
