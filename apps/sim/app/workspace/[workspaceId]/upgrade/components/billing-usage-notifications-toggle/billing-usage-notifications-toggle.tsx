'use client'

import { Label, Switch } from '@/components/emcn'
import {
  useBillingUsageNotifications,
  useUpdateGeneralSetting,
} from '@/hooks/queries/general-settings'

/**
 * Toggle controlling whether the user receives an email when they reach 80%
 * of their usage. Reads and writes the `billingUsageNotificationsEnabled`
 * general setting directly.
 */
export function BillingUsageNotificationsToggle() {
  const enabled = useBillingUsageNotifications()
  const updateSetting = useUpdateGeneralSetting()
  const isLoading = updateSetting.isPending

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-col gap-1'>
        <Label htmlFor='usage-notifications'>Usage notifications</Label>
        <span className='text-[var(--text-muted)] text-small'>Email me when I reach 80% usage</span>
      </div>
      <Switch
        id='usage-notifications'
        checked={!!enabled}
        disabled={isLoading}
        onCheckedChange={(v: boolean) => {
          if (v !== enabled) {
            updateSetting.mutate({ key: 'billingUsageNotificationsEnabled', value: v })
          }
        }}
      />
    </div>
  )
}
