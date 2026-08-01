'use client'

import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import {
  ArrowLeft,
  Button,
  ChipConfirmModal,
  ChipCopyInput,
  ChipInput,
  Duplicate,
  Eye,
  EyeOff,
  Key,
  Tooltip,
  toast,
} from '@sim/emcn'
import { getDesktopBridge } from '@/lib/desktop'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

/** The same focus-independent mask the Secrets page uses for values. */
const MASKED_STYLE = { WebkitTextSecurity: 'disc' } as CSSProperties
const MASK_PLACEHOLDER = '\u2022'.repeat(12)

/**
 * A revealed password re-hides itself rather than staying on screen for the
 * rest of the session. Long enough to read or type, short enough that walking
 * away does not leave it visible.
 */
const REVEAL_TIMEOUT_MS = 30_000

function siteLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

interface PasswordDetailProps {
  credential: BrowserCredentialMetadata
  onBack: () => void
  onForgotten: (credentials: BrowserCredentialMetadata[]) => void
}

/**
 * One saved login.
 *
 * The password is masked like any other secret field, but unlike the Secrets
 * page it does not reveal on focus — Sim does not hold the plaintext until the
 * shell hands it over, and the shell asks for Touch ID first. Copying never
 * brings the password into this page at all.
 */
export function PasswordDetail({ credential, onBack, onForgotten }: PasswordDetailProps) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingForget, setConfirmingForget] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
    setRevealed(null)
  }, [])

  // Nothing revealed may outlive this view, including a switch to another
  // credential without unmounting.
  useEffect(() => hide, [hide])
  useEffect(() => {
    hide()
  }, [hide])

  const toggleReveal = useCallback(async () => {
    if (revealed !== null) {
      hide()
      return
    }
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge?.reveal) return
    setBusy(true)
    try {
      // The shell prompts for Touch ID here; null means the user declined.
      const password = await bridge.reveal(credential.id)
      if (password === null) return
      setRevealed(password)
      hideTimer.current = setTimeout(hide, REVEAL_TIMEOUT_MS)
    } catch {
      toast.error('Could not show that password')
    } finally {
      setBusy(false)
    }
  }, [credential.id, hide, revealed])

  const copy = useCallback(async () => {
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge?.copy) return
    setBusy(true)
    try {
      await bridge.copy(credential.id)
    } catch {
      toast.error('Could not copy that password')
    } finally {
      setBusy(false)
    }
  }, [credential.id])

  const forget = useCallback(async () => {
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge) return
    setBusy(true)
    try {
      hide()
      onForgotten(await bridge.forget(credential.id))
      onBack()
    } catch {
      toast.error('Could not forget that password')
    } finally {
      setBusy(false)
    }
  }, [credential.id, hide, onBack, onForgotten])

  const site = siteLabel(credential.origin)
  const canReveal = typeof getDesktopBridge()?.browserCredentials?.reveal === 'function'

  return (
    <>
      <SettingsPanel
        back={{ text: 'Passwords', icon: ArrowLeft, onSelect: onBack }}
        title={site}
        description='Saved on this device, encrypted. Chat can never read, choose, or type it.'
        actions={[
          {
            text: 'Forget',
            variant: 'destructive' as const,
            onSelect: () => setConfirmingForget(true),
            disabled: busy,
          },
        ]}
      >
        <SettingsSection label='Login'>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <span className='text-[var(--text-muted)] text-caption'>Site</span>
              <div className='flex items-center gap-2.5'>
                <div className='size-9 flex-shrink-0'>
                  <div className='flex size-full items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                    {credential.icon ? (
                      // A `data:` URL copied from the source browser at import
                      // time — never a network request, which would disclose
                      // which sites the user has passwords for.
                      <img src={credential.icon} alt='' className='size-full object-contain' />
                    ) : (
                      <Key className='size-5 text-[var(--text-icon)]' />
                    )}
                  </div>
                </div>
                <ChipCopyInput value={credential.origin} copyLabel='Copy site' />
              </div>
            </div>

            <div className='flex flex-col gap-2'>
              <span className='text-[var(--text-muted)] text-caption'>Username</span>
              <ChipCopyInput value={credential.username || '—'} copyLabel='Copy username' />
            </div>

            <div className='flex flex-col gap-2'>
              <span className='text-[var(--text-muted)] text-caption'>Password</span>
              <ChipInput
                readOnly
                aria-label='Password'
                value={revealed ?? MASK_PLACEHOLDER}
                style={revealed ? undefined : MASKED_STYLE}
                autoComplete='off'
                spellCheck={false}
                endAdornment={
                  <>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          type='button'
                          variant='quiet'
                          className='size-[18px] rounded-sm p-0'
                          disabled={!canReveal || busy}
                          onClick={() => void toggleReveal()}
                          aria-label={revealed ? 'Hide password' : 'Show password'}
                        >
                          {revealed ? (
                            <EyeOff className='size-[13px]' />
                          ) : (
                            <Eye className='size-[13px]' />
                          )}
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        {revealed ? 'Hide password' : 'Show password'}
                      </Tooltip.Content>
                    </Tooltip.Root>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          type='button'
                          variant='quiet'
                          className='size-[18px] rounded-sm p-0'
                          disabled={!canReveal || busy}
                          onClick={() => void copy()}
                          aria-label='Copy password'
                        >
                          <Duplicate className='size-[13px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>Copy password</Tooltip.Content>
                    </Tooltip.Root>
                  </>
                }
              />
            </div>
          </div>
        </SettingsSection>
      </SettingsPanel>

      <ChipConfirmModal
        open={confirmingForget}
        onOpenChange={(open) => !open && setConfirmingForget(false)}
        title='Forget password'
        text={[
          'Sim will delete the saved password for ',
          { text: site, bold: true },
          '. Your account on that site is not affected.',
        ]}
        confirm={{
          label: 'Forget',
          pending: busy,
          pendingLabel: 'Forgetting...',
          onClick: () => void forget(),
        }}
      />
    </>
  )
}
