import { SettingsSubpageHost } from '@/platform/app/(shell)/settings/_components/settings-subpage-host'
import { LoadingRows } from '@/platform/design-system/components'

/** Keeps the section's heading visible while authorization and content load. */
export default function OrganizationProviderLoading() {
  return (
    <SettingsSubpageHost section='integrations'>
      <LoadingRows label='Loading integration' />
    </SettingsSubpageHost>
  )
}
