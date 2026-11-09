import { Chip } from '@sim/emcn/button'
import { ConnectionPrompt } from '@sim/emcn-platform/connection-prompt'
import type { GenericSecrets } from '@/platform/shared/integrations'

interface MemberSecretsProps {
  source: GenericSecrets
  /** The personal editor, for a source each member keeps their own secrets in. */
  editorHref: string
}

export function MemberSecrets({ source, editorHref }: MemberSecretsProps) {
  if (source.mode === 'member') return <Chip href={editorHref}>Manage secrets</Chip>
  return (
    <ConnectionPrompt
      title='Your organization’s administrators manage these credentials.'
      setupGuideUrl={source.setupGuideUrl}
      options={[]}
    />
  )
}
