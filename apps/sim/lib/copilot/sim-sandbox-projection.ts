import { SIM_SANDBOXES_ENTITLEMENT } from '@/lib/copilot/entitlements'

export const RESTRICTED_SIM_SANDBOX_INPUTS = new Map([
  [
    'sandboxId',
    {
      requiredEntitlement: SIM_SANDBOXES_ENTITLEMENT,
      reason:
        'Selecting or clearing a Sim sandbox requires an active Max or Enterprise plan. Preserve any existing selection unless the user upgrades.',
    },
  ],
])
