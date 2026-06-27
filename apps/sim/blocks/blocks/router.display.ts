import { ConnectIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const RouterBlockDisplay = {
  type: 'router',
  name: 'Router (Legacy)',
  description: 'Route workflow',
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  longDescription:
    'This is a core workflow block. Intelligently direct workflow execution to different paths based on input analysis. Use natural language to instruct the router to route to certain blocks based on the input.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/router',
  hideFromToolbar: true,
} satisfies BlockDisplay

export const RouterV2BlockDisplay = {
  type: 'router_v2',
  name: 'Router',
  description: 'Route workflow based on context',
  category: 'blocks',
  bgColor: '#28C43F',
  icon: ConnectIcon,
  longDescription:
    'Intelligently route workflow execution to different paths based on context analysis. Define multiple routes with descriptions, and an LLM will determine which route to take based on the provided context.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/router',
} satisfies BlockDisplay
