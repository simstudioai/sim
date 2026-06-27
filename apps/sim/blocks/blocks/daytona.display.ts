import { DaytonaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DaytonaBlockDisplay = {
  type: 'daytona',
  name: 'Daytona',
  description: 'Run code and commands in secure cloud sandboxes',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DaytonaIcon,
  longDescription:
    'Integrate Daytona into your workflow to run AI-generated code in secure, isolated sandboxes. Create and manage sandboxes, execute shell commands, run Python, JavaScript, or TypeScript code, transfer files, and clone Git repositories.',
  docsLink: 'https://docs.sim.ai/integrations/daytona',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
