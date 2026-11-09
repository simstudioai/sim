import { EmptyState } from '@sim/emcn/empty-state'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { ConnectionPrompt } from '@sim/emcn-platform/connection-prompt'
import type { MemberSecretSource } from '@/platform/lib/integrations/member-secret-source'

interface MemberSecretsProps {
  source: MemberSecretSource
}

export function MemberSecrets({ source }: MemberSecretsProps) {
  if (source.mode === 'organization') {
    return (
      <ConnectionPrompt
        title='Your organization’s administrators manage these credentials.'
        setupGuideUrl={source.setupGuideUrl}
        options={[]}
      />
    )
  }
  if (source.names.length === 0) return <EmptyState title='No personal secrets' />
  return (
    <SettingsSection title='Personal secrets'>
      {source.names.map((name) => (
        <SettingsRow key={name} label={name}>
          <span data-type='T052' role='img' aria-label='Value hidden'>
            ••••••••
          </span>
        </SettingsRow>
      ))}
    </SettingsSection>
  )
}
