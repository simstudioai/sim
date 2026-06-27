import { ThriveIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ThriveBlockDisplay = {
  type: 'thrive',
  name: 'Thrive',
  description: 'Manage users, audiences, learning and CPD on Thrive',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ThriveIcon,
  longDescription:
    'Integrate Thrive Learning into the workflow. Manage user lifecycle, audiences and their members and managers, content assignments and enrolments, learning completions, content and activity records, CPD, tags, and skills.',
  docsLink: 'https://docs.sim.ai/tools/thrive',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay
