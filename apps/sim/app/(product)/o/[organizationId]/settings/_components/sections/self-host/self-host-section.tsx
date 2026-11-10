import { Button } from '@sim/emcn/button'
import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { CHAT_KEYS_HREF } from '@/platform/lib/data/self-host'

export default function SelfHostSection() {
  return (
    <SettingsSurface>
      <SettingsRow label='Chat keys'>
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
  )
}
