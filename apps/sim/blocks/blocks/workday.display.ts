import { WorkdayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const WorkdayBlockDisplay = {
  type: 'workday',
  name: 'Workday',
  description: 'Manage workers, hiring, onboarding, and HR operations in Workday',
  category: 'tools',
  bgColor: '#F5F0EB',
  icon: WorkdayIcon,
  longDescription:
    'Integrate Workday HRIS into your workflow. Create pre-hires, hire employees, manage worker profiles, assign onboarding plans, handle job changes, retrieve compensation data, and process terminations.',
  docsLink: 'https://docs.sim.ai/integrations/workday',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay
