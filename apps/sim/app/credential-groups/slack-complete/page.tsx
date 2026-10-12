import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { APP_ENTRY_PATH, organizationRoutes } from '@/lib/navigation/paths'
import { SlackCompletion } from '@/app/credential-groups/slack-complete/slack-completion'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'

export const metadata: Metadata = {
  title: 'Slack connection',
  robots: { index: false, follow: false },
}
interface SlackCompletePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function SlackCompletePage({ searchParams }: SlackCompletePageProps) {
  const params = await searchParams
  const scalar = (key: string) =>
    typeof params[key] === 'string' && params[key].length <= 512 ? params[key] : undefined
  const ok = params.ok === 'true'
  const signInRequired = !ok && params.reason === 'signin_required'
  const mode = params.mode === 'managed' ? 'managed' : 'search'
  const organizationId = scalar('organizationId')
  return (
    <DesktopHandoffShell
      title={ok ? 'Slack connected' : 'Slack connection failed'}
      description={
        ok
          ? 'Your connection is ready. You can return to Sim.'
          : signInRequired
            ? 'Sign in to Sim in your browser, then return to Sim and restart Slack setup.'
            : 'Authorization did not complete. Return to Sim and try connecting again.'
      }
    >
      <SlackCompletion
        organizationId={organizationId}
        mode={mode}
        ok={ok}
        state={scalar('state')}
        reason={scalar('reason')}
        credentialGroupId={scalar('credentialGroupId')}
        slackBotCredentialId={scalar('slackBotCredentialId')}
      />
      <ChipLink
        href={
          signInRequired
            ? '/login'
            : organizationId
              ? organizationRoutes(organizationId).settingsSection('search-slack')
              : APP_ENTRY_PATH
        }
      >
        {signInRequired ? 'Sign in to Sim' : 'Return to Sim'}
      </ChipLink>
    </DesktopHandoffShell>
  )
}
