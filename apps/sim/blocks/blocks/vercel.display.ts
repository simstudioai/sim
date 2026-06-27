import { VercelIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const VercelBlockDisplay = {
  type: 'vercel',
  name: 'Vercel',
  description: 'Manage Vercel deployments, projects, and infrastructure',
  category: 'tools',
  bgColor: '#171717',
  icon: VercelIcon,
  longDescription:
    'Integrate with Vercel to manage deployments, projects, domains, DNS records, environment variables, aliases, edge configs, teams, and more.',
  docsLink: 'https://docs.sim.ai/integrations/vercel',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
