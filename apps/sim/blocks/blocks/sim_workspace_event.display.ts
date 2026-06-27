import { SimTriggerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const SimWorkspaceEventBlockDisplay = {
  type: 'sim_workspace_event',
  name: 'Sim Workspace Events',
  description:
    'Run this workflow when workspace events occur: run errors or successes, deployments, and alert conditions like latency or cost spikes.',
  category: 'triggers',
  bgColor: '#33C482',
  icon: SimTriggerIcon,
  docsLink: 'https://docs.sim.ai/workflows/triggers/sim',
  triggerAllowed: true,
} satisfies BlockDisplay
