import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { ExternalLink } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/external-link'
import { CHAT_KEYS_HREF } from '@/platform/lib/data/self-host'

export default function SelfHostSection() {
  return (
    <>
      <SettingsPageHeader />
      <SettingsSurface>
        <SettingsRow
          label='Chat keys'
          description='Model-provider keys that power Chat on this deployment'
        >
          <ExternalLink href={CHAT_KEYS_HREF} label='Managed keys' />
        </SettingsRow>
      </SettingsSurface>
    </>
  )
}
