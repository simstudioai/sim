import { SimTriggerIcon } from '@/components/icons'
import { SIM_WORKSPACE_EVENT_TRIGGER_ID } from '@/lib/workspace-events/constants'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const SimWorkspaceEventBlock: BlockConfig = {
  // Literal (not SIM_WORKSPACE_EVENT_TRIGGER_ID) so scripts/generate-docs.ts
  // can scrape the type for icon-map keys; a test asserts it stays equal to
  // the constant.
  type: 'sim_workspace_event',
  name: 'Sim Workspace Events',
  description:
    'Run this workflow when workspace events occur: run errors or successes, deployments, and alert conditions like latency or cost spikes.',
  category: 'triggers',
  icon: SimTriggerIcon,
  bgColor: '#33C482',
  docsLink: 'https://docs.sim.ai/workflows/triggers/sim',
  triggerAllowed: true,
  bestPractices: `
  - Events are scoped to this workspace. Pick an event type, then optionally narrow to specific workflows (empty selection watches all).
  - This workflow must be deployed for the trigger to fire, and it never receives events about itself.
  - Runs started by this trigger never emit workspace events, so side-effect workflows cannot chain or loop.
  - Alert conditions (latency spike, cost threshold, consecutive failures, ...) fire at most once per cooldown window; plain events fire on every occurrence.
  - Compose any blocks downstream (Slack, email, webhooks, custom logic) to act on the event payload.
  `,
  subBlocks: [...getTrigger(SIM_WORKSPACE_EVENT_TRIGGER_ID).subBlocks],

  tools: {
    access: [],
  },

  inputs: {},

  outputs: {},

  triggers: {
    enabled: true,
    available: [SIM_WORKSPACE_EVENT_TRIGGER_ID],
  },
}
