'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { InlineNotice, StatusTag } from '@sim/emcn/status'
import {
  DetailHeader,
  FieldStack,
  FormFieldset,
  Muted,
  Preformatted,
  SectionStack,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import {
  CLI_TOOL_OPTIONS,
  DEPENDENCY_PLACEHOLDERS,
  LANGUAGE_OPTIONS,
  type Sandbox,
  type SandboxCliToolId,
  type SandboxDependencyIssue,
  type SandboxDraft,
  SYSTEM_PACKAGE_PLACEHOLDER,
} from '@/platform/lib/data/sandboxes'
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

function contentsSummary(sandbox: Sandbox): string {
  const dependencies = sandbox.dependencies.length
  return [
    `${dependencies} ${dependencies === 1 ? 'dependency' : 'dependencies'}`,
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
          Dependencies, system packages, and managed CLI tools install at run time on this
          deployment, adding startup time per execution. Prebuilt sandboxes require E2B.
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
          No dependencies, system packages, or managed CLI tools yet. Add one above to build this
          sandbox; until then it runs on the Function base.
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
  /** The saved sandbox, absent while creating one. */
  sandbox: Sandbox | null
  strategy: 'prebuilt' | 'runtime'
  draft: SandboxDraft
  onChange: (draft: SandboxDraft) => void
  dependencyIssues: SandboxDependencyIssue[]
  systemPackageIssues: SandboxDependencyIssue[]
  canAdmin: boolean
  dirty: boolean
  saving: boolean
  deleting: boolean
  retrying: boolean
  canRetry: boolean
  onBack: () => void
  onSave: () => void
  onDiscard: () => void
  onRetry: () => void
  onDelete: () => Promise<void>
}

/** A sandbox's packages, managed CLI tools and build, or a new one's form. */
export function SandboxEditor({
  sandbox,
  strategy,
  draft,
  onChange,
  dependencyIssues,
  systemPackageIssues,
  canAdmin,
  dirty,
  saving,
  deleting,
  retrying,
  canRetry,
  onBack,
  onSave,
  onDiscard,
  onRetry,
  onDelete,
}: SandboxEditorProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const disabled = !canAdmin || saving
  return (
    <SectionStack>
      <DetailHeader
        backLabel='Sandboxes'
        onBack={onBack}
        title={sandbox ? sandbox.name : 'New sandbox'}
        description='Dependencies, system packages, and managed CLI tools available to your Function blocks.'
      />
      <FormFieldset disabled={disabled}>
        <SettingsSection title='Details'>
          <FieldStack>
            <TextField
              label='Name'
              value={draft.name}
              onChange={(name) => onChange({ ...draft, name })}
              placeholder='bigquery-etl'
              maxLength={64}
              autoComplete='off'
              disabled={disabled}
            />
            <SelectField
              label='Language'
              value={draft.language}
              onValueChange={(language) => onChange({ ...draft, language })}
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
              onChange={(dependencies) => onChange({ ...draft, dependencies })}
              placeholder={DEPENDENCY_PLACEHOLDERS[draft.language]}
              defaultSize='expanded'
              spellCheck={false}
              autoComplete='off'
              hint='One per line. Version pins are optional.'
              error={issueText(dependencyIssues)}
              disabled={disabled}
            />
            <MultiSelect
              label='Managed CLI tools'
              options={CLI_TOOL_OPTIONS}
              value={draft.cliTools}
              onValueChange={(cliTools) =>
                onChange({ ...draft, cliTools: cliTools as SandboxCliToolId[] })
              }
              placeholder='Select managed CLI tools'
              searchLabel='Search managed CLI tools'
              disabled={disabled}
            />
            <TextAreaField
              label='System packages'
              value={draft.systemPackages}
              onChange={(systemPackages) => onChange({ ...draft, systemPackages })}
              placeholder={SYSTEM_PACKAGE_PLACEHOLDER}
              defaultSize='expanded'
              spellCheck={false}
              autoComplete='off'
              hint='One Debian/APT package per line. Version pins are optional.'
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
            onRetry={canAdmin ? onRetry : undefined}
            retrying={retrying}
            retryDisabled={!canRetry}
          />
        </SettingsSection>
      )}
      <SaveActions
        dirty={dirty}
        saving={saving}
        blocked={!canAdmin || draft.name.trim().length === 0}
        onSave={onSave}
        onDiscard={onDiscard}
      />
      {sandbox && canAdmin && (
        <SettingsSection title='Manage sandbox'>
          <SettingsRow label='Delete sandbox'>
            <Button
              variant='quiet'
              destructive
              disabled={deleting}
              onClick={() => setConfirmingDelete(true)}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      {sandbox && (
        <Modal
          variant='confirm'
          destructive
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title='Delete sandbox'
          description={`This will permanently delete ${sandbox.name} and remove it from any Function blocks that are using it. This action cannot be undone.`}
          confirmLabel='Delete'
          onConfirm={onDelete}
        />
      )}
    </SectionStack>
  )
}
