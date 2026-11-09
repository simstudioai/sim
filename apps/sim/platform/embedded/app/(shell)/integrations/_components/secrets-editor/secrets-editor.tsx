'use client'

import { type ClipboardEvent, type ReactNode, useMemo, useState } from 'react'
import { EmptyState } from '@sim/emcn/empty-state'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { FailureNotice } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { countPasteRows } from '@sim/utils/paste'
import { useRouter } from 'next/navigation'
import {
  applyVariableEdits,
  createEmptyEnvVar,
  parseEnvVarLine,
  parseValidEnvVars,
  updateEnvVarArray,
  validateEnvVarKey,
} from '@/components/secrets/secret-rows'
import { setRecordValue } from '@/lib/core/utils/records'
import { organizationRoutes } from '@/lib/navigation/paths'
import type { SecretSourceMode } from '@/lib/organization-secrets/validation'
import { useOrganization } from '@/lib/organizations/provider'
import { toast } from '@/lib/toast/sink'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  DetailHeader,
  DraftConflictNotice,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import { useServerDraft } from '@/platform/embedded/app/(shell)/_components/use-server-draft'
import { IntegrationsBack } from '@/platform/embedded/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { ProviderHeading } from '@/platform/embedded/app/(shell)/integrations/_components/provider-heading/provider-heading'
import {
  NewRow,
  SavedRow,
} from '@/platform/embedded/app/(shell)/integrations/_components/secrets-editor/secret-rows'
import {
  mergeSecretsDraft,
  planSecretsSave,
  rebaseAfterSecretsSave,
  type SecretsDraft,
  sameSecretsDraft,
} from '@/platform/embedded/app/(shell)/integrations/_components/secrets-editor/secrets-draft'
import styles from '@/platform/embedded/app/(shell)/integrations/_components/secrets-editor/secrets-editor.module.css'
import { useGenericSecrets } from '@/platform/embedded/lib/data/generic-secrets'
import { memberSecretMetadata } from '@/platform/embedded/lib/integrations/metadata.generated'

const logger = createLogger('SecretsManager')
const MAX_ENV_PASTE_ROWS = 10_000

interface SecretsHeaderProps {
  mode: SecretSourceMode
  backLabel: string
  onBack: () => void
}

/** A member reads this as one more integration's page, and an admin as a section of Sources. */
function SecretsHeader({ mode, backLabel, onBack }: SecretsHeaderProps) {
  if (mode === 'organization')
    return <DetailHeader backLabel={backLabel} onBack={onBack} title={memberSecretMetadata.name} />
  return (
    <>
      <IntegrationsBack label={backLabel} onBack={onBack} />
      <ProviderHeading
        name={memberSecretMetadata.name}
        description={memberSecretMetadata.description}
      />
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
  const { organization } = useOrganization()
  const router = useRouter()
  const { failure, editor } = useGenericSecrets(mode)
  const routes = organizationRoutes(organization.id)
  const back =
    mode === 'organization'
      ? { text: 'Sources', href: routes.settingsSection('integrations') }
      : { text: 'Integrations', href: backHref ?? routes.integrations }
  const failureNotice = failure && (
    <FailureNotice message={failure.message} retrying={failure.retrying} onRetry={failure.retry} />
  )
  /** A failed refetch keeps the editor mounted with its drafts; only a first load shows failure. */
  if (!editor)
    return (
      <SectionStack>
        <SecretsHeader mode={mode} backLabel={back.text} onBack={() => router.push(back.href)} />
        {failureNotice ?? <LoadingRows label='Loading secrets…' />}
      </SectionStack>
    )
  return (
    <SecretRows
      key={editor.sourceId}
      back={back}
      mode={mode}
      refreshFailure={failureNotice ?? undefined}
      variables={editor.variables}
      save={editor.save}
      isSaving={editor.isSaving}
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
      <AutofillDecoys />
      <SecretsHeader
        mode={mode}
        backLabel={back.text}
        onBack={() => guard.guardBack(() => router.push(back.href))}
      />
      {conflict && (
        <DraftConflictNotice onKeepMine={secrets.keepMine} onTakeLatest={resetToSaved} />
      )}
      {refreshFailure}
      <SectionSearch subject='secrets' value={searchTerm} onValueChange={setSearchTerm} />
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
