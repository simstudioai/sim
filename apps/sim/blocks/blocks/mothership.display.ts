import { Blimp } from '@/components/emcn'
import type { BlockDisplay } from '@/blocks/manifest'

export const MothershipBlockDisplay = {
  type: 'mothership',
  name: 'Sim',
  description: 'Talk to Sim',
  category: 'blocks',
  bgColor: '#802FDE',
  icon: Blimp,
  longDescription:
    'The Sim block sends messages to Sim, which has access to subagents, integration tools, memory, and workspace context. Use it to perform complex multi-step reasoning, cross-service queries, or any task that benefits from the full Sim intelligence within a workflow.',
} satisfies BlockDisplay
