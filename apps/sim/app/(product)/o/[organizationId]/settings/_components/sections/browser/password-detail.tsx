'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { toast } from '@/lib/toast/sink'
import { DetailHeader } from '@/app/(product)/_components/settings-parts/settings-parts'
import { CredentialIcon } from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/credential-icon'
import { type BrowserCredential, getDesktopBridge } from '@/platform/lib/data/desktop'

const MASK_PLACEHOLDER = '•'.repeat(12)

/**
 * A revealed password hides itself again: long enough to read or type, short enough that walking
 * away does not leave it on screen.
 */
const REVEAL_TIMEOUT_MS = 30_000

export function siteLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

interface PasswordDetailProps {
  credential: BrowserCredential
  onBack: () => void
  onForgotten: (credentials: BrowserCredential[]) => void
}

/**
 * One saved login. Sim holds no plaintext until the shell hands it over after Touch ID, and copying
 * never brings the password into this page at all.
 */
export function PasswordDetail({ credential, onBack, onForgotten }: PasswordDetailProps) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingForget, setConfirmingForget] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    setRevealed(null)
  }

  // Nothing revealed may outlive this view, including a switch to another credential.
  useEffect(() => {
    hide()
    return hide
  }, [credential.id])

  const toggleReveal = async () => {
    if (revealed !== null) {
      hide()
      return
    }
    const credentials = getDesktopBridge()?.browserCredentials
    if (!credentials) return
    setBusy(true)
    try {
      // The shell prompts for Touch ID here; null means the user declined.
      const password = await credentials.reveal(credential.id)
      if (password === null) return
      setRevealed(password)
      hideTimer.current = setTimeout(hide, REVEAL_TIMEOUT_MS)
    } catch {
      toast.error('Could not show that password')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const credentials = getDesktopBridge()?.browserCredentials
    if (!credentials) return
    setBusy(true)
    try {
      await credentials.copy(credential.id)
    } catch {
      toast.error('Could not copy that password')
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    const credentials = getDesktopBridge()?.browserCredentials
    if (!credentials) return
    hide()
    try {
      onForgotten(await credentials.forget(credential.id))
      onBack()
    } catch {
      toast.error('Could not forget that password')
      return false
    }
  }

  const site = siteLabel(credential.origin)
  return (
    <>
      <DetailHeader
        backLabel='Passwords'
        onBack={onBack}
        title={site}
        description='Saved on this device, encrypted. Chat can never read, choose, or type it.'
      />
      <SettingsSection title='Login'>
        <SettingsRow label='Site' leading={<CredentialIcon icon={credential.icon} />} field>
          <Input label='Site' value={credential.origin} placeholder='Site' viewOnly />
        </SettingsRow>
        <SettingsRow label='Username' field>
          <Input
            label='Username'
            value={credential.username || '—'}
            placeholder='Username'
            viewOnly
          />
        </SettingsRow>
        <SettingsRow label='Password' field>
          <Input
            label='Password'
            value={revealed ?? MASK_PLACEHOLDER}
            placeholder='Password'
            readOnly
            masked={revealed === null}
            autoComplete='off'
            spellCheck={false}
            trailing={
              <>
                <IconButton
                  label={revealed ? 'Hide password' : 'Show password'}
                  icon={revealed ? 'eye-off' : 'eye'}
                  size='compact'
                  tooltip
                  disabled={busy}
                  onClick={() => void toggleReveal()}
                />
                <IconButton
                  label='Copy password'
                  icon='I006'
                  size='compact'
                  tooltip
                  disabled={busy}
                  onClick={() => void copy()}
                />
              </>
            }
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Manage password'>
        <SettingsRow label='Forget password'>
          <Button
            variant='quiet'
            destructive
            size='compact'
            disabled={busy}
            onClick={() => setConfirmingForget(true)}
          >
            Forget
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={confirmingForget}
        onClose={() => setConfirmingForget(false)}
        title='Forget password'
        description={`Sim will delete the saved password for ${site}. Your account on that site is not affected.`}
        confirmLabel='Forget'
        pendingLabel='Forgetting…'
        onConfirm={forget}
      />
    </>
  )
}
