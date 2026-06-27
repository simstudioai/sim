import { LinkedInIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LinkedInBlockDisplay = {
  type: 'linkedin',
  name: 'LinkedIn',
  description: 'Share posts and manage your LinkedIn presence',
  category: 'tools',
  bgColor: '#0072B1',
  icon: LinkedInIcon,
  iconColor: '#0072B1',
  longDescription:
    'Integrate LinkedIn into workflows. Share posts to your personal feed and access your LinkedIn profile information.',
  docsLink: 'https://docs.sim.ai/integrations/linkedin',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
