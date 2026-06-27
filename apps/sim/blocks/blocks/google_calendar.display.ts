import { GoogleCalendarIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleCalendarBlockDisplay = {
  type: 'google_calendar',
  name: 'Google Calendar (Legacy)',
  description: 'Manage Google Calendar events',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleCalendarIcon,
  longDescription:
    'Integrate Google Calendar into the workflow. Can create, read, update, and list calendar events.',
  docsLink: 'https://docs.sim.ai/integrations/google_calendar',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const GoogleCalendarV2BlockDisplay = {
  ...GoogleCalendarBlockDisplay,
  type: 'google_calendar_v2',
  name: 'Google Calendar',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: false,
} satisfies BlockDisplay
