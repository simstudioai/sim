import styles from '#auth/components/legal/legal.module.css'

interface AuthLegalProps {
  action: string
  termsHref: string
  privacyHref: string
}
/** Uses host-supplied legal URLs, opening them separately without losing form state. */
export function AuthLegal({ action, termsHref, privacyHref }: AuthLegalProps) {
  return (
    <p className={styles.legal}>
      By {action}, you agree to our{' '}
      <a href={termsHref} target='_blank' rel='noopener noreferrer'>
        Terms of Service
      </a>{' '}
      and{' '}
      <a href={privacyHref} target='_blank' rel='noopener noreferrer'>
        Privacy&nbsp;Policy
      </a>
      .
    </p>
  )
}
