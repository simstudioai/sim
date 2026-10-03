import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { AuthHeader, AuthNavPrompt } from '@/app/(auth)/components'

interface RegistrationDisabledProps {
  /** Post-auth destination the visitor arrived with, already validated. */
  callbackUrl: string | null
  isInviteFlow: boolean
}

/**
 * The signup page under DISABLE_REGISTRATION. Visitors reach it from a stale
 * link, a bookmark, or an invitation, so it wears the same shell as the form it
 * replaces and carries the post-auth destination over to login — an invited
 * visitor who lands here can still sign in and end up back on their invitation
 * rather than losing it.
 */
export function RegistrationDisabled({ callbackUrl, isInviteFlow }: RegistrationDisabledProps) {
  return (
    <div className='space-y-6'>
      <AuthHeader
        title='Account creation is disabled'
        description='Ask your admin to create an account for you.'
      />
      <AuthNavPrompt
        prompt='Already have an account?'
        href={buildAuthCrossLink('/login', { callbackUrl, isInviteFlow })}
        linkLabel='Sign in'
      />
    </div>
  )
}
