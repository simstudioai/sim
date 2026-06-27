import { AgentMailIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AgentMailBlockDisplay = {
  type: 'agentmail',
  name: 'AgentMail',
  description: 'Manage email inboxes, threads, and messages with AgentMail',
  category: 'tools',
  bgColor: '#000000',
  icon: AgentMailIcon,
  longDescription:
    'Integrate AgentMail into your workflow. Create and manage email inboxes, send and receive messages, reply to threads, manage drafts, and organize threads with labels. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/agentmail',
  integrationType: IntegrationType.Email,
} satisfies BlockDisplay
