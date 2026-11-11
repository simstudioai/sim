'use client'

import { type ClipboardEvent, type ReactNode, useId } from 'react'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { SecretValueInput } from '@/app/(product)/_components/secrets-editor/secret-value-input'
import styles from '@/app/(product)/_components/secrets-editor/secrets-editor.module.css'
import {
  copySecretName,
  type UIEnvironmentVariable,
  validateEnvVarKey,
} from '@/platform/lib/data/secrets'

/** Keys a scope's rows and prefixes their salted autofill names. */
export type SecretScopeId = 'organization' | 'member' | 'workspace' | 'personal'

const OVERRIDDEN_MESSAGE = 'A workspace secret with this name overrides it. Rename it to use it'

function secretRowActions({
  name,
  onViewDetails,
  onDelete,
}: {
  name: string
  onViewDetails?: () => void
  onDelete?: () => void
}): MenuAction[] {
  return [
    ...(onViewDetails ? [{ id: 'details', label: 'View details', onSelect: onViewDetails }] : []),
    { id: 'copy', label: 'Copy name', onSelect: () => copySecretName(name) },
    ...(onDelete
      ? [
          {
            id: 'delete',
            label: 'Delete',
            destructive: true,
            separatorBefore: true,
            onSelect: onDelete,
          },
        ]
      : []),
  ]
}

function SecretRowMenu(props: Parameters<typeof secretRowActions>[0]) {
  return (
    <ActionMenu label='Secret actions' icon='I108' align='end' actions={secretRowActions(props)} />
  )
}

/** Clears a field's read-only state on focus so a password manager never fills it first. */
function unlockOnFocus(event: { currentTarget: HTMLInputElement }) {
  event.currentTarget.removeAttribute('readOnly')
}

function RowMessage({ children }: { children: ReactNode }) {
  return (
    <p className={styles.message} data-type='T060' role='alert'>
      {children}
    </p>
  )
}

interface SavedRowProps {
  scope: SecretScopeId
  envKey: string
  value: string
  /** The name being typed over `envKey`, while it is being renamed. */
  pendingKey: string | null
  /** Editing the value, deleting and renaming; renaming also needs create access. */
  canEdit: boolean
  canReveal: boolean
  overridden: boolean
  onRenameStart: () => void
  onPendingKeyChange: (value: string) => void
  onRenameEnd: () => void
  onValueChange: (value: string) => void
  onDelete: () => void
  onViewDetails?: () => void
}

/** A saved secret: its name renames on blur, and its value edits in place. */
export function SavedRow({
  scope,
  envKey,
  value,
  pendingKey,
  canEdit,
  canReveal,
  overridden,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onValueChange,
  onDelete,
  onViewDetails,
}: SavedRowProps) {
  /** Salts the `name` attributes so password managers cannot match them to a known field. */
  const autofillSalt = useId()
  return (
    <>
      <Input
        label={`Name of ${envKey}`}
        name={`${scope}_env_key_${envKey}_${autofillSalt}`}
        placeholder='API_KEY'
        value={pendingKey ?? envKey}
        invalid={overridden}
        onChange={(next) => {
          if (pendingKey === null) onRenameStart()
          onPendingKeyChange(next)
        }}
        onBlur={onRenameEnd}
        onFocus={canEdit ? unlockOnFocus : undefined}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck={false}
        readOnly
      />
      <SecretValueInput
        label={`Value of ${envKey}`}
        name={`${scope}_env_value_${envKey}_${autofillSalt}`}
        value={value}
        onChange={onValueChange}
        canEdit={canEdit}
        canReveal={canReveal}
        unmasked={overridden}
        readOnly={overridden}
        placeholder={overridden ? 'Workspace override active' : 'Enter value'}
      />
      <SecretRowMenu
        name={envKey}
        onViewDetails={onViewDetails}
        onDelete={canEdit ? onDelete : undefined}
      />
      {overridden && <RowMessage>{OVERRIDDEN_MESSAGE}</RowMessage>}
    </>
  )
}

interface NewRowProps {
  scope: SecretScopeId
  noun?: string
  envVar: UIEnvironmentVariable
  index: number
  /** Another new row in the same scope has this name. */
  duplicate: boolean
  overridden: boolean
  onUpdate: (index: number, field: 'key' | 'value', value: string) => void
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void
  onDelete: () => void
}

/** A secret being typed, saved with the rest. */
export function NewRow({
  scope,
  noun,
  envVar,
  index,
  duplicate,
  overridden,
  onUpdate,
  onPaste,
  onDelete,
}: NewRowProps) {
  const autofillSalt = useId()
  const keyError = validateEnvVarKey(envVar.key)
  const hasContent = Boolean(envVar.key || envVar.value)
  const blankLabel = noun ? `New ${noun} secret` : 'New secret'
  const message =
    keyError ??
    (duplicate ? 'Another new secret has this name' : overridden ? OVERRIDDEN_MESSAGE : undefined)
  return (
    <>
      <Input
        label={envVar.key ? `Name of ${envVar.key}` : `${blankLabel} name`}
        name={`new_${scope}_key_${envVar.id ?? index}_${autofillSalt}`}
        value={envVar.key}
        placeholder='API_KEY'
        invalid={Boolean(message)}
        onChange={(next) => onUpdate(index, 'key', next)}
        onPaste={onPaste}
        onFocus={unlockOnFocus}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck={false}
        readOnly
      />
      <SecretValueInput
        label={envVar.key ? `Value of ${envVar.key}` : `${blankLabel} value`}
        name={`new_${scope}_value_${envVar.id ?? index}_${autofillSalt}`}
        value={envVar.value}
        onChange={(next) => onUpdate(index, 'value', next)}
        onPaste={onPaste}
        unmasked={overridden}
        readOnly={overridden}
        placeholder={overridden ? 'Workspace override active' : 'Enter value'}
      />
      {hasContent ? <SecretRowMenu name={envVar.key} onDelete={onDelete} /> : <span />}
      {message && <RowMessage>{message}</RowMessage>}
    </>
  )
}
