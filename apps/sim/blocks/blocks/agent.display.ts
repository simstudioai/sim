import { AgentIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AgentBlockDisplay = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  category: 'blocks',
  bgColor: 'var(--brand)',
  icon: AgentIcon,
  longDescription:
    'The Agent block is a core workflow block that is a wrapper around an LLM. It takes in system/user prompts and calls an LLM provider. It can also make tool calls by directly containing tools inside of its tool input. It can additionally return structured output.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/agent',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
