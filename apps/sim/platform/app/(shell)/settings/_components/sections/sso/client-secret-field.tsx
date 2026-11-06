'use client'

import { useState } from 'react'
import { ActionRow } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { Button, SecretField, TextField } from '@/platform/design-system/components'
import { maskedClientSecret } from '@/platform/lib/data/sso'

interface ClientSecretFieldProps {
  /** A secret is saved, so the field opens as a masked fact rather than an input. */
  hasStoredSecret: boolean
  storedHint: string | null
  isReplacing: boolean
  onReplace: () => void
  onKeepSaved: () => void
  value: string
  onChange: (value: string) => void
  error?: string
}

/**
 * A saved client secret is a fact, not an editable value: the browser never receives it, so nothing
 * here can reveal or copy it. A static masked row with an explicit Replace avoids the "will blank
 * clear it?" ambiguity an empty input invites, and keeps a stray keystroke from arming a replacement.
 */
export function ClientSecretField({
  hasStoredSecret,
  storedHint,
  isReplacing,
  onReplace,
  onKeepSaved,
  value,
  onChange,
  error,
}: ClientSecretFieldProps) {
  const [unlocked, setUnlocked] = useState(false)
  if (hasStoredSecret && !isReplacing) {
    return (
      <>
        <TextField
          label='Client secret'
          value={maskedClientSecret(storedHint)}
          readOnly
          autoComplete='off'
          hint={storedHint ? `Saved client secret ending ${storedHint}` : 'Saved client secret'}
        />
        <ActionRow>
          <Button size='compact' onClick={onReplace}>
            Replace
          </Button>
        </ActionRow>
      </>
    )
  }
  return (
    <div className='contents' onFocusCapture={() => setUnlocked(true)}>
      {/* Offscreen rather than hidden: managers skip hidden fields, so they would fill the real one. */}
      <input
        type='text'
        name='fakeusernameremembered'
        autoComplete='username'
        aria-hidden='true'
        className='-left-[9999px] pointer-events-none absolute opacity-0'
        tabIndex={-1}
        readOnly
      />
      <input
        type='password'
        name='fakepasswordremembered'
        autoComplete='current-password'
        aria-hidden='true'
        className='-left-[9999px] pointer-events-none absolute opacity-0'
        tabIndex={-1}
        readOnly
      />
      <input
        type='email'
        name='fakeemailremembered'
        autoComplete='email'
        aria-hidden='true'
        className='-left-[9999px] pointer-events-none absolute opacity-0'
        tabIndex={-1}
        readOnly
      />
      <SecretField
        label='Client secret'
        name='sso_client_key'
        placeholder='Enter Client Secret'
        autoComplete='off'
        readOnly={!unlocked}
        maskAsText
        hint={isReplacing ? 'Replaces the saved secret when you save.' : undefined}
        error={error}
        value={value}
        onChange={onChange}
      />
      {hasStoredSecret && (
        <ActionRow>
          <Button size='compact' onClick={onKeepSaved}>
            Keep saved
          </Button>
        </ActionRow>
      )}
    </div>
  )
}
