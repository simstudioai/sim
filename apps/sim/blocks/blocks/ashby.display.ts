import { AshbyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AshbyBlockDisplay = {
  type: 'ashby',
  name: 'Ashby',
  description: 'Manage candidates, jobs, and applications in Ashby',
  category: 'tools',
  bgColor: '#5D4ED6',
  icon: AshbyIcon,
  iconColor: '#5D4ED6',
  longDescription:
    'Integrate Ashby into the workflow. Manage candidates (list, get, create, update, search, tag), applications (list, get, create, change stage), jobs (list, get), job postings (list, get), offers (list, get), notes (list, create), interviews (list), and reference data (sources, tags, archive reasons, custom fields, departments, locations, openings, users).',
  docsLink: 'https://docs.sim.ai/integrations/ashby',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay
