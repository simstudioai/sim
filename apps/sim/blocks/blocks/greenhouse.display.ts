import { GreenhouseIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GreenhouseBlockDisplay = {
  type: 'greenhouse',
  name: 'Greenhouse',
  description: 'Manage candidates, jobs, and applications in Greenhouse',
  category: 'tools',
  bgColor: '#469776',
  icon: GreenhouseIcon,
  iconColor: '#469776',
  longDescription:
    'Integrate Greenhouse into the workflow. List and retrieve candidates, jobs, applications, users, departments, offices, and job stages from your Greenhouse ATS account.',
  docsLink: 'https://docs.sim.ai/integrations/greenhouse',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay
