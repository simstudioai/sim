import { AgentPhoneIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AgentPhoneBlockDisplay = {
  type: 'agentphone',
  name: 'AgentPhone',
  description: 'Provision numbers, send SMS and iMessage, and place voice calls with AgentPhone',
  category: 'tools',
  bgColor: 'linear-gradient(135deg, #1a1a1a 0%, #0a2a14 100%)',
  icon: AgentPhoneIcon,
  longDescription:
    'Give your workflow a phone. Provision SMS- and voice-enabled numbers, send messages and tapback reactions, place outbound voice calls, manage conversations and contacts, and track usage — all through a single AgentPhone API key.',
  docsLink: 'https://docs.sim.ai/integrations/agentphone',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
