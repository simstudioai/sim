'use client'

import {
  type ClipboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { countPasteRows } from '@sim/utils/paste'
import { useRouter } from 'next/navigation'
import {
  applyVariableEdits,
  createEmptyEnvVar,
  parseEnvVarLine,
  parseValidEnvVars,
  type UIEnvironmentVariable,
  updateEnvVarArray,
  validateEnvVarKey,
} from '@/components/secrets/secret-rows'
import { setRecordValue } from '@/lib/core/utils/records'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import {
  useOrganizationSecrets,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'
import styles from '@/platform/app/(shell)/integrations/_components/secrets-editor/secrets-editor.module.css'
import {
  DetailHeader,
  LoadingState,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  ActionMenu,
  Button,
  EmptyState,
  FailureNotice,
  Input,
  SearchField,
  Tooltip,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'

const logger = createLogger('SecretsManager')
const MAX_ENV_PASTE_ROWS = 10_000

function copyName(key: string) {
  void navigator.clipboard.writeText(key)
  toast.success('Copied name to clipboard')
}

interface NameInputProps {
  label: string
  name: string
  value: string
  placeholder?: string
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
  placeholder?: string
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
    <ActionMenu
      label='Secret actions'
      icon='I108'
      actions={[
        { id: 'copy', label: 'Copy name', onSelect: () => copyName(name) },
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
  const autofillSalt = useId()
  return (
    <>
      <NameInput
        label={`${envKey} name`}
        name={`workspace_env_key_${envKey}_${autofillSalt}`}
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

function NewRow({ envVar, index, onUpdate, onPaste }: NewRowProps) {
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
        <span />
      )}
      {keyError && (
        <p className={styles.rowError} data-type='T052' role='alert'>
          {keyError}
        </p>
      )}
    </>
  )
}

interface SecretsEditorProps {
  mode: SecretSourceMode
  /** The way back, for a member who came from a filtered list. */
  backHref?: string
}

/** One source's Generic Secrets: the organization's, or the viewer's own. */
export function SecretsEditor({ mode, backHref }: SecretsEditorProps) {
  const { organization, viewer } = useOrganizationContext()
  const router = useRouter()
  const secrets = useOrganizationSecrets(organization.id, mode, mode === 'member' || viewer.isAdmin)
  const save = useSaveOrganizationSecrets(organization.id)
  const routes = organizationRoutes(organization.id)
  const back =
    mode === 'organization'
      ? { text: 'Sources', href: routes.settingsSection('integrations') }
      : { text: 'Integrations', href: backHref ?? routes.integrations }
  /** A failed refetch keeps the editor mounted with its drafts; only a first load shows failure. */
  if (!secrets.data)
    return (
      <SectionStack>
        <DetailHeader
          backLabel={back.text}
          onBack={() => router.push(back.href)}
          title='Generic Secrets'
          pageHeading={mode === 'member'}
        />
        {secrets.error ? (
          <FailureNotice
            message={getErrorMessage(secrets.error, 'Could not load secrets')}
            retrying={secrets.isFetching}
            onRetry={() => void secrets.refetch()}
          />
        ) : (
          <LoadingState label='Loading secrets…' />
        )}
      </SectionStack>
    )
  const data = secrets.data
  return (
    <SecretRows
      key={data.source.id}
      back={back}
      mode={mode}
      refreshFailure={
        secrets.error ? (
          <FailureNotice
            message={getErrorMessage(secrets.error, 'Could not refresh secrets')}
            retrying={secrets.isFetching}
            onRetry={() => void secrets.refetch()}
          />
        ) : undefined
      }
      variables={data.variables}
      save={(changes) => save.mutateAsync({ ...changes, sourceId: data.source.id, mode })}
      isSaving={save.isPending}
    />
  )
}

interface SecretRowsProps {
  back: { text: string; href: string }
  mode: SecretSourceMode
  refreshFailure?: ReactNode
  variables: Record<string, string>
  save: (changes: { upsert: Record<string, string>; remove: string[] }) => Promise<unknown>
  isSaving: boolean
}

function SecretRows({ back, mode, refreshFailure, variables, save, isSaving }: SecretRowsProps) {
  const sectionLabel = mode === 'organization' ? 'Organization' : 'Personal'
  const router = useRouter()
  const [draft, setDraft] = useState<{
    variables: Record<string, string>
    rows: UIEnvironmentVariable[]
  }>(() => ({ variables: {}, rows: [createEmptyEnvVar()] }))
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState('')
  const savedRef = useRef<Record<string, string>>({})
  const acknowledgedRef = useRef<Record<string, string> | undefined>(undefined)
  const term = searchTerm.trim().toLowerCase()
  const entries = Object.entries(draft.variables).filter(
    ([key]) => !term || key.toLowerCase().includes(term)
  )
  const newRows = draft.rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => !term || row.key.toLowerCase().includes(term))

  const hasChanges = useMemo(() => {
    const before = savedRef.current
    const after = draft.variables
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
    if (Object.keys(before).length !== Object.keys(after).length) return true
    for (const key of allKeys) {
      if (before[key] !== after[key]) return true
    }
    if (draft.rows.some((row) => row.key || row.value)) return true
    return Boolean(renamingKey && pendingKeyValue !== renamingKey)
  }, [draft, renamingKey, pendingKeyValue])
  const hasIncompleteRows = draft.rows.some((row) => Boolean(row.key) !== Boolean(row.value))
  const hasInvalidKeys = draft.rows.some((row) => Boolean(row.key && validateEnvVarKey(row.key)))

  function resetToSaved() {
    if (isSaving) return
    setDraft({ variables: { ...savedRef.current }, rows: [createEmptyEnvVar()] })
    setRenamingKey(null)
    setPendingKeyValue('')
  }

  const guard = useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: isSaving,
    onDiscard: resetToSaved,
  })

  /** A refetch never overwrites an edit in progress: the draft takes it only while clean. */
  useEffect(() => {
    if (hasChanges || isSaving || acknowledgedRef.current === variables) return
    acknowledgedRef.current = variables
    savedRef.current = variables
    setDraft((current) => ({ ...current, variables }))
  }, [variables, hasChanges, isSaving])

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

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, field: 'key' | 'value') {
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
    if (lines.length === 0) return
    if (field && !lines.some((line) => parseEnvVarLine(line) !== null)) return
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
    if (isSaving || hasIncompleteRows || hasInvalidKeys) return
    const merged = { ...draft.variables }
    for (const row of draft.rows) {
      if (row.key && row.value) setRecordValue(merged, row.key, row.value)
    }
    const before = savedRef.current
    const upsert: Record<string, string> = {}
    const remove: string[] = []
    for (const [key, value] of Object.entries(merged)) {
      if (!Object.hasOwn(before, key) || before[key] !== value) setRecordValue(upsert, key, value)
    }
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(merged, key)) remove.push(key)
    }
    const changed = Object.keys(upsert).length > 0 || remove.length > 0
    const edited = draft.variables
    const submitted = new Map(
      draft.rows.filter((row) => row.key && row.value).map((row) => [row.id, row])
    )
    try {
      if (changed) await save({ upsert, remove })
      if (changed) acknowledgedRef.current = variables
      const saved = applyVariableEdits(before, merged, variables)
      savedRef.current = saved
      setDraft((current) => {
        const next = { ...saved }
        for (const row of submitted.values()) {
          if (Object.hasOwn(edited, row.key)) setRecordValue(next, row.key, edited[row.key])
          else delete next[row.key]
        }
        const rows: UIEnvironmentVariable[] = []
        for (const row of current.rows) {
          if (submitted.has(row.id) && row.key && row.value)
            setRecordValue(next, row.key, row.value)
          else rows.push(row)
        }
        return {
          variables: applyVariableEdits(edited, current.variables, next),
          rows: rows.length > 0 ? rows : [createEmptyEnvVar()],
        }
      })
      if (changed) toast.success('Secrets saved')
    } catch (error) {
      logger.error('Failed to save secrets', { error: getErrorMessage(error, 'Unknown error') })
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
      <div className={styles.autofillDecoys} aria-hidden='true'>
        <input
          type='text'
          name='fakeusernameremembered'
          autoComplete='username'
          tabIndex={-1}
          readOnly
        />
        <input
          type='password'
          name='fakepasswordremembered'
          autoComplete='current-password'
          tabIndex={-1}
          readOnly
        />
        <input
          type='email'
          name='fakeemailremembered'
          autoComplete='email'
          tabIndex={-1}
          readOnly
        />
      </div>
      <DetailHeader
        backLabel={back.text}
        onBack={() => guard.guardBack(() => router.push(back.href))}
        title='Generic Secrets'
        pageHeading={mode === 'member'}
      >
        {hasChanges && (
          <Button size='compact' disabled={isSaving} onClick={resetToSaved}>
            Discard
          </Button>
        )}
        <Tooltip label={saveBlockedReason ?? ''} enabled={Boolean(saveBlockedReason)}>
          <span>
            <Button
              variant='primary'
              size='compact'
              disabled={isSaving || !hasChanges || Boolean(saveBlockedReason)}
              onClick={() => void handleSave()}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </span>
        </Tooltip>
      </DetailHeader>
      {refreshFailure}
      <SearchField
        label='Search secrets'
        placeholder='Search secrets...'
        value={searchTerm}
        onValueChange={setSearchTerm}
      />
      {(!term || entries.length > 0 || newRows.length > 0) && (
        <SettingsSection title={sectionLabel}>
          <div className={styles.rows}>
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
                key={row.id || originalIndex}
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
    </SectionStack>
  )
}
