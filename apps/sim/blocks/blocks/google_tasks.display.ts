import { GoogleTasksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleTasksBlockDisplay = {
  type: 'google_tasks',
  name: 'Google Tasks',
  description: 'Manage Google Tasks',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleTasksIcon,
  longDescription:
    'Integrate Google Tasks into your workflow. Create, read, update, delete, and list tasks and task lists.',
  docsLink: 'https://docs.sim.ai/integrations/google_tasks',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
