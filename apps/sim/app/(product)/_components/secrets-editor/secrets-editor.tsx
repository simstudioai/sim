'use client'

import {
  type ClipboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast/sink'
import { SecretValueInput } from '@/app/(product)/_components/secrets-editor/secret-value-input'
import {
  appendPastedRows,
  duplicateRowKeys,
  mergeSecretsDraft,
  planSecretsPaste,
  planSecretsSave,
  rebaseAfterSecretsSave,
  removeSecretRow,
  type SecretsDraft,
  sameSecretsDraft,
} from '@/app/(product)/_components/secrets-editor/secrets-draft'
import styles from '@/app/(product)/_components/secrets-editor/secrets-editor.module.css'
import { useServerDraft } from '@/app/(product)/_components/secrets-editor/use-server-draft'
import {
  DetailHeader,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { useGenericSecrets } from '@/platform/lib/data/generic-secrets'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  clearPendingCredentialCreateRequest,
  copySecretName,
  createEmptyEnvVar,
  generateRowId,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
  type SecretRowAccess,
  setRecordValue,
  type UIEnvironmentVariable,
  updateEnvVarArray,
  useSettingsSearch,
  useWorkspaceSecrets,
  validateEnvVarKey,
} from '@/platform/lib/data/secrets'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { memberSecretMetadata } from '@/platform/lib/integrations/metadata.generated'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { LOCALE } from '@/platform/shared/time'

const MAX_ENV_PASTE_ROWS = 10_000
/** A pending create request older than this came from a tab the viewer has moved on from. */
const PENDING_CREATE_REQUEST_MAX_AGE_MS = 15 * 60 * 1000
const FULL_ACCESS: SecretRowAccess = { canEdit: true, canReveal: true }

/** Holds a way back behind the editor's unsaved-changes guard. */
type GuardBack = (leave: () => void) => void

/** Whose secrets the editor holds. */
type SecretsEditorScope =
  | { kind: 'organization' | 'member'; organizationId: string }
  | { kind: 'workspace'; workspaceId: string; onViewDetails: (credentialId: string) => void }

interface SecretsEditorProps {
  scope: SecretsEditorScope
  /**
   * The heading and way back of a page the editor fills on its own, such as a member's Integrations
   * entry. Without one, an organization's secrets lead back to Sources.
   */
  header?: (guardBack: GuardBack) => ReactNode
}

/** An organization's, a member's, or a workspace's and the viewer's own secrets, edited in place. */
export function SecretsEditor({ scope, header }: SecretsEditorProps) {
  if (scope.kind === 'workspace')
    return <WorkspaceSecrets workspaceId={scope.workspaceId} onViewDetails={scope.onViewDetails} />
  return (
    <GenericSecrets
      organizationId={scope.organizationId}
      mode={scope.kind}
      header={
        header ??
        (scope.kind === 'organization'
          ? (guardBack: GuardBack) => <SourcesHeader guardBack={guardBack} />
          : undefined)
      }
    />
  )
}

interface GenericSecretsProps {
  organizationId: string
  mode: 'organization' | 'member'
  header?: (guardBack: GuardBack) => ReactNode
}

/** One source's Generic Secrets: the organization's, or the viewer's own. */
function GenericSecrets({ organizationId, mode, header }: GenericSecretsProps) {
  const { failure, editor } = useGenericSecrets(organizationId, mode)
  const failureNotice = failure && (
    <FailureNotice message={failure.message} retrying={failure.retrying} onRetry={failure.retry} />
  )
  /** A failed refetch keeps the editor mounted with its drafts; only a first load shows failure. */
  if (!editor)
    return (
      <SectionStack>
        {header?.((leave) => leave())}
        {failureNotice}
      </SectionStack>
    )
  return (
    <SecretRows
      key={editor.sourceId}
      header={header}
      refreshFailure={failureNotice}
      isSaving={editor.isSaving}
      scopes={[
        {
          id: mode,
          title: mode === 'organization' ? 'Organization' : 'Personal',
          variables: editor.variables,
          save: ({ upsert, remove }) => editor.save({ upsert, remove }),
        },
      ]}
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

interface WorkspaceSecretsProps {
  workspaceId: string
  onViewDetails: (credentialId: string) => void
}

/**
 * The workspace's and the viewer's own secrets, saved together. A personal secret the workspace
 * also names is overridden by it, and a secret named by a `{{` suggestion's "Add secret" arrives
 * as a pending create request.
 */
function WorkspaceSecrets({ workspaceId, onViewDetails }: WorkspaceSecretsProps) {
  const { canMutate, permission } = useWorkspaceSettingsSection(workspaceId, 'secrets')
  const secrets = useWorkspaceSecrets(workspaceId, permission === 'admin')

  if (secrets.failed)
    return (
      <FailureNotice
        message='Could not load secrets.'
        retrying={secrets.retrying}
        onRetry={secrets.retry}
      />
    )
  if (!secrets.workspaceVariables || !secrets.personalVariables) return null
  const personal: Record<string, string> = {}
  for (const { key, value } of Object.values(secrets.personalVariables)) {
    setRecordValue(personal, key, value)
  }
  return (
    <SecretRows
      key={workspaceId}
      isSaving={secrets.isSaving}
      createRequestsFor={workspaceId}
      onViewDetails={onViewDetails}
      scopes={[
        {
          id: 'workspace',
          title: 'Workspace',
          noun: 'workspace',
          variables: secrets.workspaceVariables,
          canCreate: canMutate,
          rowAccess: secrets.rowAccess,
          save: ({ upsert, remove }) => secrets.saveWorkspace({ upsert, remove }),
        },
        {
          id: 'personal',
          title: 'Personal',
          noun: 'personal',
          variables: personal,
          overriddenBy: 0,
          takesCreateRequests: true,
          save: ({ saved }) => secrets.savePersonal(saved),
        },
      ]}
    />
  )
}

interface SecretScope {
  /** Keys the section and prefixes the salted autofill names. */
  id: 'organization' | 'member' | 'workspace' | 'personal'
  title: string
  /** Names a new row while it is blank: `New workspace secret name`. */
  noun?: string
  variables: Record<string, string>
  /** Whether new rows are offered and saved rows may be renamed. */
  canCreate?: boolean
  rowAccess?: ReadonlyMap<string, SecretRowAccess>
  /** The index of a scope whose same-named secrets override this one's. */
  overriddenBy?: number
  /** A `{{` suggestion's "Add secret" adds its name here. */
  takesCreateRequests?: boolean
  save: (plan: {
    upsert: Record<string, string>
    remove: string[]
    saved: Record<string, string>
  }) => Promise<unknown>
}

interface SecretRowsProps {
  scopes: SecretScope[]
  isSaving: boolean
  header?: (guardBack: GuardBack) => ReactNode
  refreshFailure?: ReactNode
  /** The workspace whose pending create requests land in the scope that takes them. */
  createRequestsFor?: string
  onViewDetails?: (credentialId: string) => void
}

const sameDrafts = (left: SecretsDraft[], right: SecretsDraft[]) =>
  left.length === right.length &&
  left.every((draft, index) => sameSecretsDraft(draft, right[index]))

const mergeDrafts = (mine: SecretsDraft[], base: SecretsDraft[], theirs: SecretsDraft[]) =>
  mine.map((draft, index) => mergeSecretsDraft(draft, base[index], theirs[index]))

/** Every name a scope holds or is about to hold. */
function scopeKeys(draft: SecretsDraft): Set<string> {
  const keys = new Set(Object.keys(draft.variables))
  for (const row of draft.rows) if (row.key) keys.add(row.key)
  return keys
}

function scrollToEnd(grid: HTMLDivElement | null | undefined) {
  requestAnimationFrame(() => {
    grid?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function SecretRows({
  scopes,
  isSaving,
  header,
  refreshFailure,
  createRequestsFor,
  onViewDetails,
}: SecretRowsProps) {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [renaming, setRenaming] = useState<{ scope: number; key: string } | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState('')
  const grids = useRef<(HTMLDivElement | null)[]>([])
  const secrets = useServerDraft<SecretsDraft[]>({
    server: scopes.map((scope) => ({ variables: scope.variables, rows: [createEmptyEnvVar()] })),
    isEqual: sameDrafts,
    merge: mergeDrafts,
    saving: isSaving,
    uncommitted: Boolean(renaming && pendingKeyValue !== renaming.key),
  })
  const { draft, dirty: hasChanges, conflict, edit } = secrets
  const term = searchTerm.trim().toLowerCase()

  const editScope = (index: number, update: (current: SecretsDraft) => SecretsDraft) =>
    edit((current) =>
      current.map((scope, position) => (position === index ? update(scope) : scope))
    )

  const overrides = scopes.map((scope) =>
    scope.overriddenBy === undefined ? new Set<string>() : scopeKeys(draft[scope.overriddenBy])
  )
  const duplicates = draft.map((scope) => duplicateRowKeys(scope.rows))
  const isOverridden = (index: number, key: string) => Boolean(key) && overrides[index].has(key)
  const hasConflicts = draft.some((scope, index) =>
    [...scopeKeys(scope)].some((key) => isOverridden(index, key))
  )
  const hasDuplicates = duplicates.some((keys) => keys.size > 0)
  const hasIncompleteRows = draft.some((scope) =>
    scope.rows.some((row) => Boolean(row.key) !== Boolean(row.value))
  )
  const hasInvalidKeys = draft.some((scope) =>
    scope.rows.some((row) => Boolean(row.key && validateEnvVarKey(row.key)))
  )

  function resetToSaved() {
    if (isSaving) return
    secrets.takeLatest()
    setRenaming(null)
    setPendingKeyValue('')
  }

  const guard = useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: isSaving,
    onDiscard: resetToSaved,
  })

  const createScope = scopes.findIndex((scope) => scope.takesCreateRequests)
  const applyCreateRequest = useEffectEvent((request: PendingCredentialCreateRequest) => {
    if (createScope < 0 || request.workspaceId !== createRequestsFor) return
    if (Date.now() - request.requestedAt > PENDING_CREATE_REQUEST_MAX_AGE_MS) {
      clearPendingCredentialCreateRequest()
      return
    }
    const envKey = request.envKey || ''
    if (envKey) {
      editScope(createScope, (current) => {
        const wanted = envKey.toLowerCase()
        if ([...scopeKeys(current)].some((key) => key.toLowerCase() === wanted)) return current
        return {
          ...current,
          rows: [
            ...current.rows.filter((row) => row.key || row.value),
            { key: envKey, value: '', id: generateRowId() },
          ],
        }
      })
      scrollToEnd(grids.current[createScope])
    }
    clearPendingCredentialCreateRequest()
  })

  useEffect(() => {
    if (!createRequestsFor) return
    const request = readPendingCredentialCreateRequest()
    if (request) applyCreateRequest(request)
    const handlePendingCreateRequest = (event: Event) => {
      const detail = (event as CustomEvent<PendingCredentialCreateRequest>).detail
      if (detail) applyCreateRequest(detail)
    }
    window.addEventListener(PENDING_CREDENTIAL_CREATE_REQUEST_EVENT, handlePendingCreateRequest)
    return () =>
      window.removeEventListener(
        PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
        handlePendingCreateRequest
      )
  }, [createRequestsFor])

  function endRename(scopeIndex: number, currentKey: string, currentValue: string) {
    const newKey = pendingKeyValue.trim()
    if (!renaming || renaming.scope !== scopeIndex || renaming.key !== currentKey) return
    setRenaming(null)
    if (!newKey || newKey === currentKey) return
    if (validateEnvVarKey(newKey) || Object.hasOwn(draft[scopeIndex].variables, newKey)) {
      toast.error('Use a valid, unique secret name')
      return
    }
    editScope(scopeIndex, (current) => {
      const next = { ...current.variables }
      delete next[currentKey]
      setRecordValue(next, newKey, currentValue)
      return { ...current, variables: next }
    })
  }

  function handlePaste(scopeIndex: number, event: ClipboardEvent<HTMLInputElement>) {
    const paste = planSecretsPaste(event.clipboardData.getData('text'), MAX_ENV_PASTE_ROWS)
    if (paste.kind === 'native') return
    event.preventDefault()
    if (paste.kind === 'too-many') {
      toast.warning('Paste has too many secrets', {
        description: `Add up to ${MAX_ENV_PASTE_ROWS.toLocaleString(LOCALE)} rows at once.`,
      })
      return
    }
    editScope(scopeIndex, (current) => ({
      ...current,
      rows: appendPastedRows(current.rows, paste.rows),
    }))
    scrollToEnd(grids.current[scopeIndex])
  }

  async function handleSave() {
    if (
      isSaving ||
      conflict ||
      hasConflicts ||
      hasDuplicates ||
      hasIncompleteRows ||
      hasInvalidKeys
    )
      return
    const submitted = draft
    const plans = scopes.map((scope, index) =>
      planSecretsSave(secrets.baseline[index].variables, submitted[index], scope.variables)
    )
    const results = await Promise.allSettled(
      plans.map((plan, index) => (plan.changed ? scopes[index].save(plan) : Promise.resolve()))
    )
    const landed = results.map((result) => result.status === 'fulfilled')
    secrets.markSaved(
      submitted,
      plans.map((plan, index) =>
        landed[index] ? { variables: plan.saved, rows: [] } : secrets.baseline[index]
      ),
      (current) =>
        current.map((scope, index) =>
          landed[index]
            ? rebaseAfterSecretsSave(submitted[index], scope, plans[index].saved)
            : scope
        )
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) {
      toast.error(getErrorMessage(failure.reason, 'Failed to save secrets'))
      return
    }
    if (plans.some((plan) => plan.changed)) toast.success('Secrets saved')
  }

  const visible = scopes.map((scope, index) => {
    const access = scope.rowAccess
    const entries = Object.entries(draft[index].variables).filter(
      ([key]) =>
        !term ||
        key.toLowerCase().includes(term) ||
        Boolean(access?.get(key)?.description?.toLowerCase().includes(term))
    )
    const rows =
      scope.canCreate === false
        ? []
        : draft[index].rows
            .map((row, originalIndex) => ({ row, originalIndex }))
            .filter(({ row }) => !term || row.key.toLowerCase().includes(term))
    return { entries, rows }
  })
  const noMatches =
    Boolean(term) && visible.every(({ entries, rows }) => entries.length === 0 && rows.length === 0)

  const saveBlockedReason = hasConflicts
    ? 'Resolve all conflicts before saving'
    : hasInvalidKeys
      ? 'Fix invalid variable names before saving'
      : hasDuplicates
        ? 'Give each new secret its own name'
        : hasIncompleteRows
          ? 'Enter both a name and value for each secret'
          : undefined

  return (
    <SectionStack>
      <AutofillDecoys />
      {header?.(guard.guardBack)}
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
            placeholder='Search secrets…'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      />
      {scopes.map((scope, scopeIndex) => {
        const { entries, rows } = visible[scopeIndex]
        if (term && entries.length === 0 && rows.length === 0) return null
        const canCreate = scope.canCreate ?? true
        return (
          <SettingsSection key={scope.id} title={scope.title}>
            <div
              className={styles.grid}
              ref={(grid) => {
                grids.current[scopeIndex] = grid
              }}
            >
              {entries.map(([key, value]) => {
                const access = scope.rowAccess?.get(key) ?? FULL_ACCESS
                const canEdit = canCreate && access.canEdit
                const credentialId = access.credentialId
                return (
                  <SavedRow
                    key={key}
                    scope={scope.id}
                    envKey={key}
                    value={value}
                    pendingKey={
                      renaming?.scope === scopeIndex && renaming.key === key
                        ? pendingKeyValue
                        : null
                    }
                    canEdit={canEdit}
                    canReveal={access.canReveal}
                    overridden={isOverridden(scopeIndex, key)}
                    onRenameStart={() => {
                      setRenaming({ scope: scopeIndex, key })
                      setPendingKeyValue(key)
                    }}
                    onPendingKeyChange={setPendingKeyValue}
                    onRenameEnd={() => endRename(scopeIndex, key, value)}
                    onValueChange={(next) =>
                      editScope(scopeIndex, (current) => {
                        const variables = { ...current.variables }
                        setRecordValue(variables, key, next)
                        return { ...current, variables }
                      })
                    }
                    onDelete={() =>
                      editScope(scopeIndex, (current) => {
                        const variables = { ...current.variables }
                        delete variables[key]
                        return { ...current, variables }
                      })
                    }
                    onViewDetails={
                      credentialId && onViewDetails
                        ? () => guard.guardBack(() => onViewDetails(credentialId))
                        : undefined
                    }
                  />
                )
              })}
              {rows.map(({ row, originalIndex }) => (
                <NewRow
                  key={row.id ?? originalIndex}
                  scope={scope.id}
                  noun={scope.noun}
                  envVar={row}
                  index={originalIndex}
                  duplicate={duplicates[scopeIndex].has(row.key)}
                  overridden={isOverridden(scopeIndex, row.key)}
                  onUpdate={(index, field, next) =>
                    editScope(scopeIndex, (current) => ({
                      ...current,
                      rows: updateEnvVarArray(current.rows, index, field, next),
                    }))
                  }
                  onPaste={(event) => handlePaste(scopeIndex, event)}
                  onDelete={() =>
                    editScope(scopeIndex, (current) => ({
                      ...current,
                      rows: removeSecretRow(current.rows, originalIndex),
                    }))
                  }
                />
              ))}
            </div>
          </SettingsSection>
        )
      })}
      {noMatches && <EmptyState title={`No secrets found matching “${searchTerm}”`} />}
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

const OVERRIDDEN_MESSAGE =
  'Workspace variable with the same name overrides this. Rename your personal key to use it.'

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
  scope: SecretScope['id']
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
function SavedRow({
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
  scope: SecretScope['id']
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
function NewRow({
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
    (duplicate ? 'Another new secret has this name.' : overridden ? OVERRIDDEN_MESSAGE : undefined)
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
