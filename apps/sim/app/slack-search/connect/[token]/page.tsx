import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { slackSearchOnboardingPath } from '@/lib/slack-search/onboarding'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { AuthShell } from '@/app/(auth)/components'
import { SlackSearchOnboarding } from '@/app/slack-search/connect/[token]/slack-search-onboarding'

export const metadata: Metadata = {
  title: 'Get started with Sim in Slack',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

interface SlackSearchOnboardingPageProps {
  params: Promise<{ token: string }>
}

export default async function SlackSearchOnboardingPage({
  params,
}: SlackSearchOnboardingPageProps) {
  const { token } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))
    notFound()
  const session = await getSession()
  const callbackUrl = slackSearchOnboardingPath(token)
  return (
    <AuthShell>
      {session?.user?.id ? (
        <SlackSearchOnboarding token={token} userId={session.user.id} />
      ) : (
        <div className='flex flex-col gap-5'>
          <h1 className='text-2xl'>Get started with Sim in Slack</h1>
          <p className='text-[var(--text-secondary)] text-sm'>
            Sign in or create an account using your Slack email. After setup, you can retry your
            question in the same Slack thread.
          </p>
          <div className='flex gap-2'>
            <ChipLink
              variant='primary'
              href={buildAuthCrossLink('/signup', { callbackUrl, isInviteFlow: false })}
            >
              Create account
            </ChipLink>
            <ChipLink href={buildAuthCrossLink('/login', { callbackUrl, isInviteFlow: false })}>
              Sign in
            </ChipLink>
          </div>
          <p className='text-[var(--text-tertiary)] text-sm'>
            Your organization’s invitation and SSO requirements still apply.
          </p>
        </div>
      )}
    </AuthShell>
  )
}
