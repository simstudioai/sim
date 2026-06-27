import { TailscaleIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const TailscaleBlockDisplay = {
  type: 'tailscale',
  name: 'Tailscale',
  description: 'Manage devices and network settings in your Tailscale tailnet',
  category: 'tools',
  bgColor: '#2E2D2D',
  icon: TailscaleIcon,
  longDescription:
    'Interact with the Tailscale API to manage devices, DNS, ACLs, auth keys, users, and routes across your tailnet.',
  docsLink: 'https://docs.sim.ai/integrations/tailscale',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
