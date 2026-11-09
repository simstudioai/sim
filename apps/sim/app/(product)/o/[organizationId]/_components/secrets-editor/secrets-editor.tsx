'use client'

import { type ClipboardEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { countPasteRows } from '@sim/utils/paste'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast/sink'
import {
  DetailHeader,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  mergeSecretsDraft,
  planSecretsSave,
  rebaseAfterSecretsSave,
  type SecretsDraft,
  sameSecretsDraft,
} from '@/app/(product)/o/[organizationId]/_components/secrets-editor/secrets-draft'
import styles from '@/app/(product)/o/[organizationId]/_components/secrets-editor/secrets-editor.module.css'
import { useServerDraft } from '@/app/(product)/o/[organizationId]/_components/secrets-editor/use-server-draft'
import { useGenericSecrets } from '@/platform/lib/data/generic-secrets'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  applyVariableEdits,
  copySecretName,
  createEmptyEnvVar,
  parseEnvVarLine,
  parseValidEnvVars,
  setRecordValue,
  type UIEnvironmentVariable,
  updateEnvVarArray,
  useSettingsSearch,
  validateEnvVarKey,
} from '@/platform/lib/data/secrets'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { memberSecretMetadata } from '@/platform/lib/integrations/metadata.generated'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

const MAX_ENV_PASTE_ROWS = 10_000

type SecretSourceMode = 'organization' | 'member'

/** Clears a field's read-only state on focus so a password manager never fills it first. */
function unlockOnFocus(event: { currentTarget: HTMLInputElement }) {
  event.currentTarget.removeAttribute('readOnly')
}

interface SecretValueProps {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void
}

/** Masked until focused and read-only until then, so autofill and shoulder surfing both miss it. */
function SecretValue({ label, name, value, onChange, onPaste }: SecretValueProps) {
  const [focused, setFocused] = useState(false)
  return (
    <Input
      label={label}
      name={name}
      value={value}
      masked={!focused}
      placeholder='Enter value'
      onChange={onChange}
      onPaste={onPaste}
      readOnly
      onFocus={(event) => {
        unlockOnFocus(event)
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

function SecretRowMenu({ name, onDelete }: { name: string; onDelete: () => void }) {
  return (
    <ActionMenu
      label='Secret actions'
      icon='I108'
      align='end'
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

function SavedRow({
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
  /** Salts the `name` attributes so password managers cannot match them to a known field. */
  const autofillSalt = useId()
  return (
    <>
      <Input
        label={`Name of ${envKey}`}
        name={`workspace_env_key_${envKey}_${autofillSalt}`}
        placeholder='API_KEY'
        value={renamingKey === envKey ? pendingKeyValue : envKey}
        onChange={(next) => {
          if (renamingKey !== envKey) onRenameStart(envKey)
          onPendingKeyChange(next)
        }}
        onBlur={() => onRenameEnd(envKey, value)}
        onFocus={unlockOnFocus}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck={false}
        readOnly
      />
      <SecretValue
        label={`Value of ${envKey}`}
        name={`workspace_env_value_${envKey}_${autofillSalt}`}
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
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void
}

function NewRow({ envVar, index, onUpdate, onPaste }: NewRowProps) {
  const autofillSalt = useId()
  const keyError = validateEnvVarKey(envVar.key)
  const hasContent = Boolean(envVar.key || envVar.value)
  return (
    <>
      <Input
        label='New secret name'
        name={`new_workspace_key_${envVar.id ?? index}_${autofillSalt}`}
        value={envVar.key}
        placeholder='API_KEY'
        invalid={Boolean(keyError)}
        onChange={(next) => onUpdate(index, 'key', next)}
        onPaste={onPaste}
        onFocus={unlockOnFocus}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck={false}
        readOnly
      />
      <SecretValue
        label='New secret value'
        name={`new_workspace_value_${envVar.id ?? index}_${autofillSalt}`}
        value={envVar.value}
        onChange={(next) => onUpdate(index, 'value', next)}
        onPaste={onPaste}
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
        <span />
      )}
      {keyError && (
        <p className={styles.message} data-type='T060' role='alert'>
          {keyError}
        </p>
      )}
    </>
  )
}

/** Holds a way back behind the editor's unsaved-changes guard. */
type GuardBack = (leave: () => void) => void

interface SecretsEditorProps {
  organizationId: string
  mode: SecretSourceMode
  /**
   * The heading and way back of a page the editor fills on its own, such as a member's Integrations
   * entry. Without one, a detail header leads back to Sources.
   */
  header?: (guardBack: GuardBack) => ReactNode
}

/** One source's Generic Secrets: the organization's, or the viewer's own. */
export function SecretsEditor({ organizationId, mode, header }: SecretsEditorProps) {
  const { failure, editor } = useGenericSecrets(organizationId, mode)
  const renderHeader = header ?? ((guardBack: GuardBack) => <SourcesHeader guardBack={guardBack} />)
  const failureNotice = failure && (
    <FailureNotice message={failure.message} retrying={failure.retrying} onRetry={failure.retry} />
  )
  /** A failed refetch keeps the editor mounted with its drafts; only a first load shows failure. */
  if (!editor)
    return (
      <SectionStack>
        {renderHeader((leave) => leave())}
        {failureNotice}
      </SectionStack>
    )
  return (
    <SecretRows
      key={editor.sourceId}
      header={renderHeader}
      mode={mode}
      refreshFailure={failureNotice}
      variables={editor.variables}
      save={editor.save}
      isSaving={editor.isSaving}
    />
  )
}

/** An administrator reads the organization's secrets as a section of Sources. */
function SourcesHeader({ guardBack }: { guardBack: GuardBack }) {
  const router = useRouter()
  const sources = surfaceHref(useSurfaceScope(), '/settings/integrations')
  return (
    <DetailHeader
      backLabel='Sources'
      onBack={() => guardBack(() => router.push(sources))}
      title={memberSecretMetadata.name}
    />
  )
}

interface SecretRowsProps {
  header: (guardBack: GuardBack) => ReactNode
  mode: SecretSourceMode
  refreshFailure: ReactNode
  variables: Record<string, string>
  save: (changes: { upsert: Record<string, string>; remove: string[] }) => Promise<unknown>
  isSaving: boolean
}

function SecretRows({ header, mode, refreshFailure, variables, save, isSaving }: SecretRowsProps) {
  const sectionLabel = mode === 'organization' ? 'Organization' : 'Personal'
  const server = useMemo<SecretsDraft>(
    () => ({ variables, rows: [createEmptyEnvVar()] }),
    [variables]
  )
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState('')
  const secrets = useServerDraft({
    server,
    isEqual: sameSecretsDraft,
    merge: mergeSecretsDraft,
    saving: isSaving,
    uncommitted: Boolean(renamingKey && pendingKeyValue !== renamingKey),
  })
  const { draft, dirty: hasChanges, conflict, edit: setDraft } = secrets
  const term = searchTerm.trim().toLowerCase()
  const entries = Object.entries(draft.variables).filter(
    ([key]) => !term || key.toLowerCase().includes(term)
  )
  const newRows = draft.rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => !term || row.key.toLowerCase().includes(term))
  const hasIncompleteRows = draft.rows.some((row) => Boolean(row.key) !== Boolean(row.value))
  const hasInvalidKeys = draft.rows.some((row) => Boolean(row.key && validateEnvVarKey(row.key)))

  function resetToSaved() {
    if (isSaving) return
    secrets.takeLatest()
    setRenamingKey(null)
    setPendingKeyValue('')
  }

  const guard = useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: isSaving,
    onDiscard: resetToSaved,
  })

  function endRename(currentKey: string, currentValue: string) {
    const newKey = pendingKeyValue.trim()
    if (!renamingKey || renamingKey !== currentKey) return
    setRenamingKey(null)
    if (!newKey || newKey === currentKey) return
    if (validateEnvVarKey(newKey) || Object.hasOwn(draft.variables, newKey)) {
      toast.error('Use a valid, unique secret name')
      return
    }
    setDraft((current) => {
      const next = { ...current.variables }
      delete next[currentKey]
      setRecordValue(next, newKey, currentValue)
      return { ...current, variables: next }
    })
  }

  /** Only `KEY=VALUE` lines are taken over as new rows; plain text pastes natively. */
  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text').trim()
    if (!text) return
    if (countPasteRows(text, MAX_ENV_PASTE_ROWS) > MAX_ENV_PASTE_ROWS) {
      event.preventDefault()
      toast.warning('Paste has too many secrets', {
        description: `Add up to ${MAX_ENV_PASTE_ROWS.toLocaleString()} rows at once.`,
      })
      return
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (!lines.some((line) => parseEnvVarLine(line) !== null)) return
    const parsed = parseValidEnvVars(lines)
    if (parsed.length > 0) {
      event.preventDefault()
      setDraft((current) => ({
        ...current,
        rows: [
          ...current.rows.filter((row) => row.key || row.value),
          ...parsed,
          createEmptyEnvVar(),
        ],
      }))
    }
  }

  async function handleSave() {
    if (isSaving || conflict || hasIncompleteRows || hasInvalidKeys) return
    const before = secrets.baseline.variables
    const { merged, upsert, remove, changed } = planSecretsSave(before, draft)
    try {
      if (changed) await save({ upsert, remove })
      const saved = applyVariableEdits(before, merged, variables)
      secrets.markSaved(draft, { variables: saved, rows: [] }, (current) =>
        rebaseAfterSecretsSave(draft, current, saved)
      )
      if (changed) toast.success('Secrets saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save secrets'))
    }
  }

  const saveBlockedReason = hasInvalidKeys
    ? 'Fix invalid variable names before saving'
    : hasIncompleteRows
      ? 'Enter both a name and value for each secret'
      : undefined
  return (
    <SectionStack>
      <AutofillDecoys />
      {header(guard.guardBack)}
      {conflict && (
        <InlineNotice
          intent='warning'
          title='This changed while you were editing'
          message='Your edits are still here and have not been saved. Keep them to save over the newer version, or use the latest and lose them.'
          action={
            <>
              <Button size='compact' onClick={secrets.keepMine}>
                Keep my edits
              </Button>
              <Button size='compact' variant='quiet' onClick={resetToSaved}>
                Use the latest
              </Button>
            </>
          }
        />
      )}
      {refreshFailure}
      <SectionToolbar
        grow={
          <SearchField
            label='Search secrets'
            placeholder='Search secrets...'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      />
      {(!term || entries.length > 0 || newRows.length > 0) && (
        <SettingsSection title={sectionLabel}>
          <div className={styles.grid}>
            {entries.map(([key, value]) => (
              <SavedRow
                key={key}
                envKey={key}
                value={value}
                renamingKey={renamingKey}
                pendingKeyValue={pendingKeyValue}
                onRenameStart={(next) => {
                  setRenamingKey(next)
                  setPendingKeyValue(next)
                }}
                onPendingKeyChange={setPendingKeyValue}
                onRenameEnd={endRename}
                onValueChange={(target, next) =>
                  setDraft((current) => ({
                    ...current,
                    variables: { ...current.variables, [target]: next },
                  }))
                }
                onDelete={(target) =>
                  setDraft((current) => {
                    const next = { ...current.variables }
                    delete next[target]
                    return { ...current, variables: next }
                  })
                }
              />
            ))}
            {newRows.map(({ row, originalIndex }) => (
              <NewRow
                key={row.id ?? originalIndex}
                envVar={row}
                index={originalIndex}
                onUpdate={(index, field, value) =>
                  setDraft((current) => ({
                    ...current,
                    rows: updateEnvVarArray(current.rows, index, field, value),
                  }))
                }
                onPaste={handlePaste}
              />
            ))}
          </div>
        </SettingsSection>
      )}
      {term && entries.length === 0 && newRows.length === 0 && (
        <EmptyState title={`No secrets found matching “${searchTerm}”`} />
      )}
      <SaveActions
        dirty={hasChanges}
        saving={isSaving}
        blocked={conflict}
        blockedReason={saveBlockedReason}
        onSave={() => void handleSave()}
        onDiscard={resetToSaved}
      />
    </SectionStack>
  )
}
