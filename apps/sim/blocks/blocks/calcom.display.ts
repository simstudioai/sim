import { CalComIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CalComBlockDisplay = {
  type: 'calcom',
  name: 'Cal.com',
  description: 'Manage Cal.com bookings, event types, schedules, and availability',
  category: 'tools',
  bgColor: '#292929',
  icon: CalComIcon,
  longDescription:
    'Integrate Cal.com into your workflow. Create and manage bookings, event types, schedules, and check availability slots. Supports creating, listing, rescheduling, and canceling bookings, as well as managing event types and schedules. Can also trigger workflows based on Cal.com webhook events (booking created, cancelled, rescheduled). Connect your Cal.com account via OAuth.',
  docsLink: 'https://docs.sim.ai/integrations/calcom',
  integrationType: IntegrationType.Productivity,
  triggerAllowed: true,
} satisfies BlockDisplay
