'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import { FieldFrame } from '@/platform/design-system/components/field/fields'
import { Icon } from '@/platform/design-system/components/icon/icon'
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
    <ControlRow
      render={<span />}
      label={address}
      recipient={invalid ? 'invalid' : 'valid'}
      action={
        onRemove && (
          <IconButton
            size='compact'
            label={`Remove ${address}`}
            icon='I105'
            onClick={() => onRemove(address)}
          />
        )
      }
    />
  )
}

interface RecipientFieldProps {
  label: string
  defaultRecipients?: readonly Recipient[]
  name?: string
  placeholder?: string
}

export function RecipientField({
  label,
  defaultRecipients = [],
  name,
  placeholder,
}: RecipientFieldProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const inputEdges = useScrollEdges('horizontal', { viewport: input })
  const viewportEdges = useScrollEdges<HTMLDivElement>()
  const [recipients, setRecipients] = useState(defaultRecipients)
  const [draft, setDraft] = useState('')
  const error = recipients.some((recipient) => recipient.invalid)
    ? 'Enter a valid email address.'
    : undefined

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
    const email = document.createElement('input')
    email.type = 'email'
    const additions = addresses.map((address) => {
      email.value = address
      return { address, invalid: !email.validity.valid }
    })
    setRecipients((current) => {
      const known = new Set(current.map(({ address }) => address.toLowerCase()))
      return [
        ...current,
        ...additions.filter(({ address }) => {
          const key = address.toLowerCase()
          if (known.has(key)) return false
          known.add(key)
          return true
        }),
      ]
    })
  }

  function finish(text: string) {
    commit(text)
    setDraft('')
  }

  function remove(address: string) {
    setRecipients((current) => current.filter((recipient) => recipient.address !== address))
    input.current?.focus()
  }

  return (
    <FieldFrame id={id} label={label} error={error}>
      <div
        className={styles.recipients}
        data-invalid={error ? true : undefined}
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
              onRemove={remove}
            />
          ))}
          <input
            ref={inputEdges}
            id={id}
            inputMode='email'
            autoComplete='off'
            spellCheck={false}
            data-type='T043'
            placeholder={recipients.length ? undefined : placeholder}
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
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
                setRecipients((current) => current.slice(0, -1))
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
