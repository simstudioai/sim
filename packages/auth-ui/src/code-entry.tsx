'use client'

import { useId } from 'react'
import { AuthFormMessage } from './compositions'
import { AuthOTP, AuthOTPGroup, AuthOTPSlot } from './controls'
import { AuthButton, AuthTextLink } from './primitives'
import styles from './styles.module.css'

interface AuthCodeEntryProps {
  value: string
  onChange: (value: string) => void
  onVerify: () => void
  onResend?: () => void
  onChangeEmail?: () => void
  verifying: boolean
  resending: boolean
  countdown: number
  error?: string | null
  help?: string
}

/** Six-digit entry shared by account verification and independent resource gates. */
export function AuthCodeEntry({
  value,
  onChange,
  onVerify,
  onResend,
  onChangeEmail,
  verifying,
  resending,
  countdown,
  error,
  help,
}: AuthCodeEntryProps) {
  const errorId = useId()
  const busy = verifying || resending
  return (
    <div className={styles.stack}>
      <AuthOTP
        maxLength={6}
        value={value}
        onChange={onChange}
        disabled={busy}
        aria-label='Verification code'
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      >
        <AuthOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <AuthOTPSlot key={index} index={index} />
          ))}
        </AuthOTPGroup>
      </AuthOTP>
      {error && (
        <div id={errorId}>
          <AuthFormMessage type='error'>{error}</AuthFormMessage>
        </div>
      )}
      <AuthButton
        variant='primary'
        fullWidth
        onClick={onVerify}
        disabled={busy || value.length !== 6}
        loading={verifying}
        loadingLabel='Verifying…'
      >
        Verify email
      </AuthButton>
      {onResend && (
        <p className={styles.codeHelp}>
          Didn’t receive a code?{' '}
          {countdown > 0 ? (
            <span role='status'>Resend in {countdown}s</span>
          ) : (
            <AuthTextLink onClick={onResend} disabled={busy}>
              {resending ? 'Sending…' : 'Resend'}
            </AuthTextLink>
          )}
        </p>
      )}
      {help && <p className={styles.codeHelp}>{help}</p>}
      {onChangeEmail && (
        <div className={styles.codeHelp}>
          <AuthTextLink onClick={onChangeEmail} disabled={busy}>
            Change email
          </AuthTextLink>
        </div>
      )}
    </div>
  )
}
