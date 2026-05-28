import { createInstantlyTrigger } from '@/triggers/instantly/trigger'

export const instantlyAccountErrorTrigger = createInstantlyTrigger({
  id: 'instantly_account_error',
  name: 'Instantly Account Error',
  description: 'Trigger when Instantly reports an account-level error',
  eventLabel: 'Account Error',
})
