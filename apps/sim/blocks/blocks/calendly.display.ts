import { CalendlyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CalendlyBlockDisplay = {
  type: 'calendly',
  name: 'Calendly',
  description: 'Manage Calendly scheduling and events',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: CalendlyIcon,
  longDescription:
    'Integrate Calendly into your workflow. Manage event types, scheduled events, invitees, and webhooks. Can also trigger workflows based on Calendly webhook events (invitee scheduled, invitee canceled, routing form submitted). Requires Personal Access Token.',
  docsLink: 'https://docs.sim.ai/integrations/calendly',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay
