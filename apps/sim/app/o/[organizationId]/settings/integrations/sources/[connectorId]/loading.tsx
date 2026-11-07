import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { SettingsSubpageHost } from '@/platform/embedded/app/(shell)/settings/_components/settings-subpage-host'

/** Keeps the section's heading visible while authorization and content load. */
export default function OrganizationSourceLoading() {
  return (
    <SettingsSubpageHost section='integrations'>
      <LoadingRows label='Loading connection' />
    </SettingsSubpageHost>
  )
}
