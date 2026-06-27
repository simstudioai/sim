import { A2AIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const A2ABlockDisplay = {
  type: 'a2a',
  name: 'A2A',
  description: 'Interact with external A2A-compatible agents',
  category: 'blocks',
  bgColor: '#4151B5',
  icon: A2AIcon,
  longDescription:
    'Use the A2A (Agent-to-Agent) protocol to interact with external AI agents. ' +
    'Send messages, query task status, cancel tasks, or discover agent capabilities. ' +
    'Compatible with any A2A-compliant agent including LangGraph, Google ADK, and other Sim workflows.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/a2a',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
