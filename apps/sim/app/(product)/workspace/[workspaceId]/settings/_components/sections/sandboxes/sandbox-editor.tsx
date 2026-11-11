'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice, StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import {
  ActionRow,
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  Preformatted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  CLI_TOOL_OPTIONS,
  canRetrySandboxBuild,
  DEPENDENCY_PLACEHOLDERS,
  draftFromSandbox,
  emptyDraft,
  extractIssues,
  LANGUAGE_OPTIONS,
  type Sandbox,
  type SandboxCliToolId,
  type SandboxDependencyIssue,
  type SandboxDraft,
  SYSTEM_PACKAGE_PLACEHOLDER,
  toSubmittedLines,
  useCreateSandbox,
  useDeleteSandbox,
  useUpdateSandbox,
} from '@/platform/lib/data/sandboxes'
import { requestSettingsLeave, useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { plural } from '@/platform/shared/plural'

/** One line per rejected row, the first rejection of each line only. */
function issueText(issues: readonly SandboxDependencyIssue[]): string | undefined {
  if (issues.length === 0) return undefined
  const byLine = new Map<number, SandboxDependencyIssue>()
  for (const issue of issues) if (!byLine.has(issue.line)) byLine.set(issue.line, issue)
  return [...byLine.values()].map((issue) => `Line ${issue.line}: ${issue.reason}`).join('\n')
}

const STATUS = {
  ready: { label: 'Ready', intent: 'success' },
  failed: { label: 'Failed', intent: 'danger' },
  building: { label: 'Building', intent: 'info' },
  pending: { label: 'Queued', intent: 'info' },
} as const

/** What a sandbox installs: `3 packages · 1 system package · 2 managed CLIs`. */
export function contentsSummary(sandbox: Sandbox): string {
  return [
    plural(sandbox.dependencies.length, 'package'),
    plural(sandbox.systemPackages.length, 'system package'),
    plural(sandbox.cliTools.length, 'managed CLI'),
  ].join(' · ')
}

interface SandboxStatusProps {
  sandbox: Sandbox
  /** Runtime-strategy deployments have no build to report. */
  strategy: 'prebuilt' | 'runtime'
  onRetry?: () => void
  retrying: boolean
  retryDisabled: boolean
}

function SandboxStatus({
  sandbox,
  strategy,
  onRetry,
  retrying,
  retryDisabled,
}: SandboxStatusProps) {
  if (strategy === 'runtime')
    return (
      <FieldStack>
        <Muted>
          Packages and managed CLI tools install at run time on this deployment, adding startup time
          to each run. Prebuilt sandboxes need E2B
        </Muted>
      </FieldStack>
    )
  if (
    sandbox.dependencies.length === 0 &&
    sandbox.systemPackages.length === 0 &&
    sandbox.cliTools.length === 0
  )
    return (
      <FieldStack>
        <Muted>
          Nothing to install yet. Add a package or managed CLI tool above to build this sandbox;
          until then it runs on the Function base
        </Muted>
      </FieldStack>
    )
  const status = STATUS[sandbox.buildStatus ?? 'pending']
  const failed = sandbox.buildStatus === 'failed'
  return (
    <>
      <SettingsRow label='Build' description={contentsSummary(sandbox)}>
        <StatusTag label={status.label} intent={status.intent} live />
        {failed && onRetry && (
          <Button
            size='compact'
            disabled={retrying || retryDisabled}
            disabledReason={retryDisabled ? 'Save or discard changes before retrying' : undefined}
            onClick={onRetry}
          >
            {retrying ? 'Retrying…' : 'Retry build'}
          </Button>
        )}
      </SettingsRow>
      {failed && sandbox.errorMessage && (
        <FieldStack>
          <InlineNotice intent='danger' message={sandbox.errorMessage} />
          {sandbox.errorDetail && (
            <Disclosure label='Build log'>
              <Preformatted>{sandbox.errorDetail}</Preformatted>
            </Disclosure>
          )}
        </FieldStack>
      )}
    </>
  )
}

interface SandboxEditorProps {
  workspaceId: string
  /** The saved sandbox, absent while creating one. The list keys the editor by it. */
  sandbox: Sandbox | null
  strategy: 'prebuilt' | 'runtime'
  canAdmin: boolean
  /** Back to the list, after a save, a delete or the back action. */
  onClose: () => void
}

/**
 * A sandbox's packages, managed CLI tools and build, or a new one's form. It holds its own draft,
 * seeded from the sandbox it was keyed by, so opening another sandbox never carries edits over.
 */
export function SandboxEditor({
  workspaceId,
  sandbox,
  strategy,
  canAdmin,
  onClose,
}: SandboxEditorProps) {
  const createSandbox = useCreateSandbox()
  const updateSandbox = useUpdateSandbox()
  const deleteSandbox = useDeleteSandbox()
  const [original] = useState(() => (sandbox ? draftFromSandbox(sandbox) : emptyDraft()))
  const [draft, setDraft] = useState<SandboxDraft>(original)
  const [dependencyIssues, setDependencyIssues] = useState<SandboxDependencyIssue[]>([])
  const [systemPackageIssues, setSystemPackageIssues] = useState<SandboxDependencyIssue[]>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const dirty =
    draft.name.trim() !== original.name.trim() ||
    draft.language !== original.language ||
    draft.dependencies !== original.dependencies ||
    draft.systemPackages !== original.systemPackages ||
    draft.cliTools.join(',') !== original.cliTools.join(',')
  const saving = createSandbox.isPending || updateSandbox.isPending
  const disabled = !canAdmin || saving
  const canRetry = canRetrySandboxBuild({ canAdmin, isDirty: dirty, saving })

  const discard = () => {
    setDraft(original)
    setDependencyIssues([])
    setSystemPackageIssues([])
  }

  /** The save bar registers an edit's draft; the create form, which has none, registers here. */
  useSettingsUnsavedGuard({
    isDirty: !sandbox && dirty,
    navigationBlocked: deleteSandbox.isPending || (!sandbox && saving),
    onDiscard: sandbox ? undefined : discard,
  })

  async function save() {
    setDependencyIssues([])
    setSystemPackageIssues([])
    const body = {
      name: draft.name.trim(),
      language: draft.language,
      dependencies: toSubmittedLines(draft.dependencies),
      systemPackages: toSubmittedLines(draft.systemPackages),
      cliTools: draft.cliTools,
    }
    try {
      if (sandbox) await updateSandbox.mutateAsync({ workspaceId, sandboxId: sandbox.id, ...body })
      else await createSandbox.mutateAsync({ workspaceId, ...body })
      onClose()
    } catch (caught) {
      const lineIssues = extractIssues(caught)
      if (lineIssues) {
        setDependencyIssues(lineIssues.field === 'dependencies' ? lineIssues.issues : [])
        setSystemPackageIssues(lineIssues.field === 'systemPackages' ? lineIssues.issues : [])
        return
      }
      toast.error(getErrorMessage(caught, 'Failed to save sandbox'))
    }
  }

  async function retry() {
    if (!sandbox || !canRetry) return
    try {
      await updateSandbox.mutateAsync({
        workspaceId,
        sandboxId: sandbox.id,
        language: sandbox.language,
        dependencies: sandbox.dependencies,
        systemPackages: sandbox.systemPackages,
        cliTools: sandbox.cliTools,
      })
      toast.success('Sandbox build queued')
    } catch (caught) {
      toast.error(getErrorMessage(caught, 'Failed to retry sandbox build'))
    }
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Sandboxes'
        onBack={() => requestSettingsLeave(onClose)}
        title={sandbox ? sandbox.name : 'New sandbox'}
        description='Dependencies, system packages and managed CLI tools your Function blocks can use'
      />
      <FormFieldset disabled={disabled}>
        <SettingsSection title='Details'>
          <FieldStack>
            <TextField
              label='Name'
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
              placeholder='bigquery-etl'
              maxLength={64}
              autoComplete='off'
              disabled={disabled}
            />
            <SelectField
              label='Language'
              value={draft.language}
              onValueChange={(language) => setDraft({ ...draft, language })}
              options={LANGUAGE_OPTIONS}
              disabled={disabled}
            />
          </FieldStack>
        </SettingsSection>
        <SettingsSection title='Packages'>
          <FieldStack>
            <TextAreaField
              label='Dependencies'
              value={draft.dependencies}
              onChange={(dependencies) => setDraft({ ...draft, dependencies })}
              placeholder={DEPENDENCY_PLACEHOLDERS[draft.language]}
              defaultSize='expanded'
              spellCheck={false}
              autoComplete='off'
              error={issueText(dependencyIssues)}
              disabled={disabled}
            />
            <MultiSelect
              label='Managed CLI tools'
              options={CLI_TOOL_OPTIONS}
              value={draft.cliTools}
              onValueChange={(cliTools) =>
                setDraft({ ...draft, cliTools: cliTools as SandboxCliToolId[] })
              }
              placeholder='Select managed CLI tools'
              searchLabel='Search managed CLI tools'
              disabled={disabled}
            />
            <TextAreaField
              label='System packages'
              value={draft.systemPackages}
              onChange={(systemPackages) => setDraft({ ...draft, systemPackages })}
              placeholder={SYSTEM_PACKAGE_PLACEHOLDER}
              defaultSize='expanded'
              spellCheck={false}
              autoComplete='off'
              error={issueText(systemPackageIssues)}
              disabled={disabled}
            />
          </FieldStack>
        </SettingsSection>
      </FormFieldset>
      {sandbox && (
        <SettingsSection title='Status'>
          <SandboxStatus
            sandbox={sandbox}
            strategy={strategy}
            onRetry={canAdmin ? () => void retry() : undefined}
            retrying={updateSandbox.isPending}
            retryDisabled={!canRetry}
          />
        </SettingsSection>
      )}
      {canAdmin &&
        (sandbox ? (
          <SettingsSaveBar
            dirty={dirty}
            saving={saving}
            blocked={draft.name.trim().length === 0}
            onSave={() => void save()}
            onDiscard={discard}
          />
        ) : (
          <ActionRow>
            <Button
              variant='primary'
              disabled={saving || draft.name.trim().length === 0}
              onClick={() => void save()}
            >
              {saving ? 'Creating…' : 'Create sandbox'}
            </Button>
          </ActionRow>
        ))}
      {sandbox && canAdmin && (
        <SettingsSection title='Manage sandbox'>
          <SettingsRow label='Delete sandbox' description='Remove this sandbox from the workspace'>
            <Button
              variant='quiet'
              destructive
              disabled={deleteSandbox.isPending}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      {sandbox && (
        <ConfirmDialog
          target={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title='Delete sandbox'
          description={`${sandbox.name} is removed from every Function block that uses it. This action cannot be undone.`}
          confirmLabel='Delete'
          pendingLabel='Deleting…'
          onConfirm={async () => {
            await deleteSandbox.mutateAsync({ workspaceId, sandboxId: sandbox.id })
            onClose()
          }}
        />
      )}
    </SectionStack>
  )
}
