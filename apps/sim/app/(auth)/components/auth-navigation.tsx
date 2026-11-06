'use client'

import { AuthLinkButton } from '@sim/auth-ui'
import { usePathname, useSearchParams } from 'next/navigation'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { buildAuthCrossLink, resolveAuthRedirect } from '@/app/(auth)/auth-redirect'

interface AuthNavigationProps {
  registrationDisabled: boolean
}

/** Preserves return and invitation context in the Auth header cross-link. */
export function AuthNavigation({ registrationDisabled }: AuthNavigationProps) {
  const pathname = usePathname()
  const params = useSearchParams()
  if (pathname !== '/login' && pathname !== '/signup') return null
  if (pathname === '/login' && registrationDisabled) return null
  const { rawCallbackUrl: callback, isInviteFlow } = resolveAuthRedirect({
    redirect: params.get('redirect'),
    callbackUrl: params.get('callbackUrl'),
    inviteFlow: params.get('invite_flow'),
  })
  const href = buildAuthCrossLink(pathname === '/login' ? '/signup' : '/login', {
    callbackUrl: callback && validateCallbackUrl(callback) ? callback : null,
    isInviteFlow,
  })
  return (
    <AuthLinkButton href={href} variant='navigation'>
      {pathname === '/login' ? 'Sign up' : 'Sign in'}
    </AuthLinkButton>
  )
}
