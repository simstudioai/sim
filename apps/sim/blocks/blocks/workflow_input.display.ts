import { WorkflowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const WorkflowInputBlockDisplay = {
  type: 'workflow_input',
  name: 'Workflow',
  description: 'Execute another workflow and map variables to its Start trigger schema.',
  category: 'blocks',
  bgColor: '#6366F1',
  icon: WorkflowIcon,
  longDescription: `Execute another child workflow and map variables to its Start trigger schema. Helps with modularizing workflows.`,
  docsLink: 'https://docs.sim.ai/workflows/blocks/workflow',
} satisfies BlockDisplay
