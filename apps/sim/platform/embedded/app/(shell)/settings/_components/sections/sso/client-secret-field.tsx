'use client'

import { useState } from 'react'
import { maskedClientSecret } from '@/ee/sso/lib/provider-form'
import { AutofillDecoys, Button, SecretField, TextField } from '@/platform/design-system/components'
import { ActionRow } from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'

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
      <AutofillDecoys />
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
