'use client'

import { Button } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/_components/session-state/session-state.module.css'
import { SettingsLeaveGuard } from '@/platform/app/(shell)/_components/session-state/settings-leave-guard'
import { useImpersonation, useSessionRecovery } from '@/platform/lib/data/session'

function ImpersonationBanner() {
  const { active, name, email, stopping, stop } = useImpersonation()
  if (!active) return null
  return (
    <div className={styles.banner} role='status'>
      <span data-type='T060'>
        Impersonating {name}
        {email ? ` (${email})` : ''}. Changes will apply to this account until you switch back.
      </span>
      <Button size='compact' variant='destructive' disabled={stopping} onClick={stop}>
        {stopping ? 'Returning…' : 'Stop impersonating'}
      </Button>
    </div>
  )
}

function SessionExpired() {
  const { expired, failed, wasImpersonation, attemptRecovery } = useSessionRecovery()
  if (!expired) return null
  const subject = wasImpersonation ? 'The impersonation session expired' : 'Your session expired'
  return (
    <div className={styles.takeover}>
      <p data-type='T067' role='status'>
        {failed ? `${subject}, but signing out failed.` : `${subject}. Signing you out…`}
      </p>
      {failed && (
        <Button variant='primary' onClick={attemptRecovery}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function SessionState() {
  return (
    <>
      <ImpersonationBanner />
      <SessionExpired />
      <SettingsLeaveGuard />
    </>
  )
}
