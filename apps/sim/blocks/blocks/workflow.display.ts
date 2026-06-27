import { WorkflowIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const WorkflowBlockDisplay = {
  type: 'workflow',
  name: 'Workflow',
  description:
    'This is a core workflow block. Execute another workflow as a block in your workflow. Enter the input variable to pass to the child workflow.',
  category: 'blocks',
  bgColor: '#6366F1',
  icon: WorkflowIcon,
  hideFromToolbar: true,
} satisfies BlockDisplay
