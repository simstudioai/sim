import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyLinkClickedTrigger = createInstantlyTrigger({
  id: 'instantly_link_clicked',
  name: 'Instantly Link Clicked',
  description: 'Trigger when a lead clicks a tracked Instantly link',
  eventLabel: 'Link Clicked',
})
