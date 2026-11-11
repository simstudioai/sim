'use client'

import {
  type ClipboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SearchField } from '@sim/emcn/search-field'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  NewRow,
  SavedRow,
  type SecretScopeId,
} from '@/app/(product)/_components/secrets-editor/secret-row'
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
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  clearPendingCredentialCreateRequest,
  createEmptyEnvVar,
  generateRowId,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
  type SecretRowAccess,
  setRecordValue,
  updateEnvVarArray,
  useSettingsSearch,
  validateEnvVarKey,
} from '@/platform/lib/data/secrets'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { LOCALE } from '@/platform/shared/time'

const MAX_ENV_PASTE_ROWS = 10_000
/** A pending create request older than this came from a tab the viewer has moved on from. */
const PENDING_CREATE_REQUEST_MAX_AGE_MS = 15 * 60 * 1000
const FULL_ACCESS: SecretRowAccess = { canEdit: true, canReveal: true }

/** Holds a way back behind the Settings leave guard, which asks before dropping unsaved edits. */
export type GuardBack = (leave: () => void) => void

/** One titled group of secrets the rows edit and save together with the others. */
export interface SecretScope {
  /** Keys the section and prefixes the salted autofill names. */
  id: SecretScopeId
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

export interface SecretRowsProps {
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

/**
 * Every scope's secrets as rows edited in place and saved together: saved secrets rename on blur
 * and edit their value, new ones are typed or pasted as `.env` lines. A scope with nothing saved
 * shows an empty state until the viewer chooses to add one.
 */
export function SecretRows({
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
  /** Scopes the viewer opened from their empty state, so the blank row there shows. */
  const [adding, setAdding] = useState<ReadonlySet<number>>(() => new Set())
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
    setAdding(new Set())
  }

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
  /** A scope with nothing saved or typed, which the viewer has not opened to add one. */
  const isEmpty = (index: number) =>
    Object.keys(draft[index].variables).length === 0 &&
    draft[index].rows.every((row) => !row.key && !row.value) &&
    !adding.has(index)
  const allEmpty = scopes.every((_, index) => isEmpty(index))

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
      {header?.(requestSettingsLeave)}
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
      {!allEmpty && (
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
      )}
      {scopes.map((scope, scopeIndex) => {
        const { entries, rows } = visible[scopeIndex]
        if (term && entries.length === 0 && rows.length === 0) return null
        const canCreate = scope.canCreate ?? true
        if (!term && isEmpty(scopeIndex))
          return (
            <SettingsList
              key={scope.id}
              title={scope.title}
              empty={{
                title: scope.noun ? `No ${scope.noun} secrets yet` : 'No secrets yet',
                action: canCreate ? (
                  <Button
                    size='compact'
                    icon='I074'
                    onClick={() => setAdding((current) => new Set(current).add(scopeIndex))}
                  >
                    Add secret
                  </Button>
                ) : undefined,
              }}
            />
          )
        return (
          <SettingsList key={scope.id} title={scope.title}>
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
                        ? () => requestSettingsLeave(() => onViewDetails(credentialId))
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
          </SettingsList>
        )
      })}
      {noMatches && <EmptyState title='No matching secrets' />}
      <SettingsSaveBar
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
