import { LoadingState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { SettingsSubpageHost } from '@/platform/app/(shell)/settings/_components/settings-subpage-host'

/** Keeps the section's heading visible while authorization and content load. */
export default function OrganizationProviderLoading() {
  return (
    <SettingsSubpageHost section='integrations'>
      <LoadingState label='Loading integration' />
    </SettingsSubpageHost>
  )
}
