'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import { FieldFrame, fieldDescription } from '@/platform/design-system/components/field/fields'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import styles from '@/platform/design-system/components/workspace-fields/workspace-fields.module.css'

interface LogoUploadFieldProps {
  label: string
  optional?: boolean
}

export function LogoUploadField({ label, optional }: LogoUploadFieldProps) {
  const id = useId()
  return (
    <FieldFrame id={id} label={label} optional={optional}>
      <div className={styles.upload} data-type='T052'>
        <Icon name='I117' />
        Upload
        <input id={id} type='file' accept='image/*' className={styles.uploadInput} />
      </div>
    </FieldFrame>
  )
}

interface Recipient {
  address: string
  invalid?: boolean
}

interface RecipientTagProps extends Recipient {
  onRemove?: (address: string) => void
}

export function RecipientTag({ address, invalid, onRemove }: RecipientTagProps) {
  return (
    <span className={styles.tag} data-invalid={invalid || undefined} data-type='T052'>
      <OverflowText text={address}>{address}</OverflowText>
      {onRemove && (
        <IconButton
          size='inline'
          label={`Remove ${address}`}
          icon='I105'
          onClick={() => onRemove(address)}
        />
      )}
    </span>
  )
}

interface RecipientFieldProps {
  label: string
  defaultRecipients?: readonly Recipient[]
  /** Controlled tags. A caller can mark an address `invalid`, for one the server refused. */
  recipients?: readonly Recipient[]
  onRecipientsChange?: (recipients: Recipient[]) => void
  /** Whether a newly committed address is acceptable. Defaults to the browser's email check. */
  validate?: (address: string) => boolean
  /** Replaces the default message shown while any tag is invalid. */
  error?: string
  hint?: string
  disabled?: boolean
  name?: string
  placeholder?: string
}

function isEmailAddress(address: string) {
  const email = document.createElement('input')
  email.type = 'email'
  email.value = address
  return email.validity.valid
}

export function RecipientField({
  label,
  defaultRecipients = [],
  recipients: controlledRecipients,
  onRecipientsChange,
  validate = isEmailAddress,
  error: errorMessage,
  hint,
  disabled,
  name,
  placeholder,
}: RecipientFieldProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const inputEdges = useScrollEdges('horizontal', { viewport: input })
  const viewportEdges = useScrollEdges<HTMLDivElement>()
  const [localRecipients, setLocalRecipients] = useState(defaultRecipients)
  const recipients = controlledRecipients ?? localRecipients
  const [draft, setDraft] = useState('')
  const error =
    errorMessage ??
    (recipients.some((recipient) => recipient.invalid) ? 'Enter a valid email address.' : undefined)

  function setRecipients(next: Recipient[]) {
    setLocalRecipients(next)
    onRecipientsChange?.(next)
  }

  useLayoutEffect(() => {
    const editor = input.current
    editor?.setCustomValidity(error ?? '')
    if (editor && recipients.length && document.activeElement === editor) {
      editor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [error, recipients.length])

  function commit(text: string) {
    const addresses = text
      .trim()
      .split(/[,;\s]+/)
      .filter(Boolean)
    if (!addresses.length) return
    const known = new Set(recipients.map(({ address }) => address.toLowerCase()))
    const additions = addresses.filter((address) => {
      const key = address.toLowerCase()
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    if (!additions.length) return
    setRecipients([
      ...recipients,
      ...additions.map((address) => ({ address, invalid: !validate(address) })),
    ])
  }

  function finish(text: string) {
    commit(text)
    setDraft('')
  }

  function remove(address: string) {
    setRecipients(recipients.filter((recipient) => recipient.address !== address))
    input.current?.focus()
  }

  return (
    <FieldFrame id={id} label={label} error={error} hint={hint}>
      <div
        className={styles.recipients}
        data-invalid={error ? true : undefined}
        data-disabled={disabled || undefined}
        role='presentation'
        onClick={(event) => {
          if (event.target instanceof Element && !event.target.closest('input, button')) {
            input.current?.focus()
          }
        }}
      >
        <div ref={viewportEdges} className={styles.recipientViewport}>
          {recipients.map((recipient) => (
            <RecipientTag
              key={recipient.address}
              address={recipient.address}
              invalid={recipient.invalid}
              onRemove={disabled ? undefined : remove}
            />
          ))}
          <input
            ref={inputEdges}
            id={id}
            inputMode='email'
            autoComplete='off'
            spellCheck={false}
            disabled={disabled}
            data-type='T043'
            placeholder={recipients.length ? undefined : placeholder}
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldDescription(id, error, hint)}
            onChange={(event) => {
              const value = event.currentTarget.value
              const last = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'))
              if (
                last >= 0 &&
                !('isComposing' in event.nativeEvent && event.nativeEvent.isComposing)
              ) {
                commit(value.slice(0, last))
                setDraft(value.slice(last + 1))
              } else setDraft(value)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                finish(draft)
              } else if (event.key === 'Backspace' && !draft) {
                event.preventDefault()
                if (recipients.length) setRecipients(recipients.slice(0, -1))
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text/plain')
              if (!/[,;\s]/.test(pasted)) return
              event.preventDefault()
              const { selectionStart, selectionEnd } = event.currentTarget
              finish(
                draft.slice(0, selectionStart ?? draft.length) +
                  pasted +
                  draft.slice(selectionEnd ?? draft.length)
              )
            }}
            onBlur={() => finish(draft)}
          />
        </div>
        {name &&
          recipients.map(({ address }) => (
            <input key={address} type='hidden' name={name} value={address} />
          ))}
      </div>
    </FieldFrame>
  )
}
