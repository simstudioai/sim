import { CloudflareIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CloudflareBlockDisplay = {
  type: 'cloudflare',
  name: 'Cloudflare',
  description: 'Manage DNS, domains, certificates, and cache',
  category: 'tools',
  bgColor: '#F5F6FA',
  icon: CloudflareIcon,
  longDescription:
    'Integrate Cloudflare into the workflow. Manage zones (domains), DNS records, SSL/TLS certificates, zone settings, DNS analytics, and cache purging via the Cloudflare API.',
  docsLink: 'https://docs.sim.ai/integrations/cloudflare',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
