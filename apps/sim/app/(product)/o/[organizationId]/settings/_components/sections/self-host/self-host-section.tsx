import { Button } from '@sim/emcn/button'
import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
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
          <Button
            size='compact'
            trailingIcon='I037'
            render={
              <a href={CHAT_KEYS_HREF} target='_blank' rel='noopener noreferrer'>
                Managed keys
              </a>
            }
          >
            Managed keys
          </Button>
        </SettingsRow>
      </SettingsSurface>
    </>
  )
}
