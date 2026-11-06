import { describe, expect, it } from 'vitest'
import {
  accountStatus,
  type IntegrationAccount,
  type OrganizationIntegration,
} from '@/platform/shared/integrations'

const integration = (availability: OrganizationIntegration['availability']) =>
  ({ availability, status: 'Not offered on this plan' }) as OrganizationIntegration
const account = (status: IntegrationAccount['status']) => ({ status }) as IntegrationAccount

describe('accountStatus', () => {
  it('shows the blocked reason over a reconnect, which could not unblock it', () => {
    expect(accountStatus(integration('blocked'), account('needs_reauth'))).toBe(
      'Not offered on this plan'
    )
  })

  it('asks to reconnect a ready integration with an expired account', () => {
    expect(accountStatus(integration('ready'), account('needs_reauth'))).toBe('Reconnect needed')
  })
})
