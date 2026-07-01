import { AuthTextLink } from '@/app/(auth)/components/auth-text-link'

interface AuthLegalFooterProps {
  /** The gerund describing the consent action, e.g. "signing in". */
  action: string
}

/**
 * The "By {action}, you agree to our Terms / Privacy" fine print shared by the
 * login and signup pages. Restyled to muted light tokens with the legal links
 * routed through {@link AuthTextLink}, so the consent copy has one source.
 */
export function AuthLegalFooter({ action }: AuthLegalFooterProps) {
  return (
    <p className='text-center text-[var(--text-muted)] text-caption leading-relaxed'>
      By {action}, you agree to our{' '}
      <AuthTextLink href='/terms' external>
        Terms of Service
      </AuthTextLink>{' '}
      and{' '}
      <AuthTextLink href='/privacy' external>
        Privacy Policy
      </AuthTextLink>
    </p>
  )
}
