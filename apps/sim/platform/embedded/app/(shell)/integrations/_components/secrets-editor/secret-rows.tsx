'use client'

import { type ClipboardEvent, useId, useState } from 'react'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import {
  copySecretName,
  type UIEnvironmentVariable,
  validateEnvVarKey,
} from '@/components/secrets/secret-rows'
import styles from '@/platform/embedded/app/(shell)/integrations/_components/secrets-editor/secrets-editor.module.css'

interface NameInputProps {
  label: string
  name: string
  value: string
  placeholder: string
  invalid?: boolean
  onChange: (value: string) => void
  onBlur?: () => void
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void
}

/** Read-only until focused, under a salted name, so password managers cannot fill it. */
function NameInput({
  label,
  name,
  value,
  placeholder,
  invalid,
  onChange,
  onBlur,
  onPaste,
}: NameInputProps) {
  return (
    <Input
      label={label}
      name={name}
      value={value}
      placeholder={placeholder}
      invalid={invalid}
      onChange={onChange}
      onBlur={onBlur}
      onPaste={onPaste}
      autoComplete='off'
      autoCapitalize='off'
      spellCheck={false}
      readOnly
      onFocus={(event) => event.currentTarget.removeAttribute('readOnly')}
    />
  )
}

interface SecretValueInputProps {
  label: string
  name: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void
}

/** Masked until focused and read-only until then, so autofill and shoulder surfing both miss it. */
function SecretValueInput({
  label,
  name,
  value,
  placeholder,
  onChange,
  onPaste,
}: SecretValueInputProps) {
  const [focused, setFocused] = useState(false)
  return (
    <Input
      label={label}
      name={name}
      type='text'
      value={value}
      masked={!focused}
      placeholder={placeholder}
      onChange={onChange}
      onPaste={onPaste}
      readOnly
      onFocus={(event) => {
        event.currentTarget.removeAttribute('readOnly')
        event.currentTarget.scrollLeft = 0
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      autoComplete='off'
      autoCorrect='off'
      autoCapitalize='off'
      spellCheck={false}
    />
  )
}

interface SecretRowMenuProps {
  name: string
  onDelete: () => void
}

function SecretRowMenu({ name, onDelete }: SecretRowMenuProps) {
  return (
    <span className={styles.menu}>
      <ActionMenu
        label='Secret actions'
        icon='I108'
        actions={[
          { id: 'copy', label: 'Copy name', onSelect: () => copySecretName(name) },
          {
            id: 'delete',
            label: 'Delete',
            destructive: true,
            separatorBefore: true,
            onSelect: onDelete,
          },
        ]}
      />
    </span>
  )
}

interface SavedRowProps {
  envKey: string
  value: string
  renamingKey: string | null
  pendingKeyValue: string
  onRenameStart: (key: string) => void
  onPendingKeyChange: (value: string) => void
  onRenameEnd: (key: string, value: string) => void
  onValueChange: (key: string, value: string) => void
  onDelete: (key: string) => void
}

export function SavedRow({
  envKey,
  value,
  renamingKey,
  pendingKeyValue,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onValueChange,
  onDelete,
}: SavedRowProps) {
  const autofillSalt = useId()
  return (
    <>
      <NameInput
        label={`${envKey} name`}
        name={`workspace_env_key_${envKey}_${autofillSalt}`}
        placeholder='API_KEY'
        value={renamingKey === envKey ? pendingKeyValue : envKey}
        onChange={(next) => {
          if (renamingKey !== envKey) onRenameStart(envKey)
          onPendingKeyChange(next)
        }}
        onBlur={() => onRenameEnd(envKey, value)}
      />
      <SecretValueInput
        label={`${envKey} value`}
        name={`workspace_env_value_${envKey}_${autofillSalt}`}
        placeholder='Enter value'
        value={value}
        onChange={(next) => onValueChange(envKey, next)}
      />
      <SecretRowMenu name={envKey} onDelete={() => onDelete(envKey)} />
    </>
  )
}

interface NewRowProps {
  envVar: UIEnvironmentVariable
  index: number
  onUpdate: (index: number, field: 'key' | 'value', value: string) => void
  onPaste: (event: ClipboardEvent<HTMLInputElement>, field: 'key' | 'value') => void
}

export function NewRow({ envVar, index, onUpdate, onPaste }: NewRowProps) {
  const autofillSalt = useId()
  const keyError = validateEnvVarKey(envVar.key)
  const hasContent = Boolean(envVar.key || envVar.value)
  return (
    <>
      <NameInput
        label='New secret name'
        name={`new_workspace_key_${envVar.id || index}_${autofillSalt}`}
        value={envVar.key}
        placeholder='API_KEY'
        invalid={Boolean(keyError)}
        onChange={(next) => onUpdate(index, 'key', next)}
        onPaste={(event) => onPaste(event, 'key')}
      />
      <SecretValueInput
        label='New secret value'
        name={`new_workspace_value_${envVar.id || index}_${autofillSalt}`}
        value={envVar.value}
        placeholder='Enter value'
        onChange={(next) => onUpdate(index, 'value', next)}
        onPaste={(event) => onPaste(event, 'value')}
      />
      {hasContent ? (
        <SecretRowMenu
          name={envVar.key}
          onDelete={() => {
            onUpdate(index, 'key', '')
            onUpdate(index, 'value', '')
          }}
        />
      ) : (
        <span className={styles.menuSlot} />
      )}
      {keyError && (
        <p className={styles.rowError} data-type='T052' role='alert'>
          {keyError}
        </p>
      )}
    </>
  )
}
