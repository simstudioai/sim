'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipDropdown, ChipInput, ChipTextarea, cn } from '@sim/emcn'
import type { SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { ManagedCliSelect } from '@/app/workspace/[workspaceId]/settings/components/sandboxes/components/managed-cli-select'
import {
  DEPENDENCY_PLACEHOLDERS,
  LANGUAGE_OPTIONS,
  type SandboxDraft,
  type SandboxLanguage,
  SYSTEM_PACKAGE_PLACEHOLDER,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'
import { SettingsField } from '@/app/workspace/[workspaceId]/settings/components/settings-field'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import type { Sandbox } from '@/hooks/queries/sandboxes'

interface SandboxEditorProps {
  draft: SandboxDraft
  onChange: (draft: SandboxDraft) => void
  /** Server-reported bad dependency lines, addressed to the row the user typed them on. */
  dependencyIssues: SandboxDependencyIssue[]
  /** Server-reported bad system-package lines, addressed to the row the user typed them on. */
  systemPackageIssues: SandboxDependencyIssue[]
  disabled?: boolean
  /** Build status row. Absent for an unsaved sandbox and under the runtime strategy. */
  status?: React.ReactNode
}

export function SandboxEditor({
  draft,
  onChange,
  dependencyIssues,
  systemPackageIssues,
  disabled = false,
  status,
}: SandboxEditorProps) {
  const dependencyIssuesByLine = useMemo(() => {
    const byLine = new Map<number, SandboxDependencyIssue>()
    for (const issue of dependencyIssues) {
      if (!byLine.has(issue.line)) byLine.set(issue.line, issue)
    }
    return byLine
  }, [dependencyIssues])

  const systemPackageIssuesByLine = useMemo(() => {
    const byLine = new Map<number, SandboxDependencyIssue>()
    for (const issue of systemPackageIssues) {
      if (!byLine.has(issue.line)) byLine.set(issue.line, issue)
    }
    return byLine
  }, [systemPackageIssues])

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection label='Details'>
        <div className='flex flex-col gap-4'>
          <SettingsField label='Name'>
            <ChipInput
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              placeholder='bigquery-etl'
              disabled={disabled}
              maxLength={64}
              autoComplete='off'
            />
          </SettingsField>
          <SettingsField label='Language'>
            <ChipDropdown
              value={draft.language}
              onChange={(language) => onChange({ ...draft, language: language as SandboxLanguage })}
              options={LANGUAGE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              disabled={disabled}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection label='Dependencies'>
        <div className='flex flex-col gap-2'>
          <ChipTextarea
            value={draft.dependencies}
            onChange={(event) => onChange({ ...draft, dependencies: event.target.value })}
            placeholder={DEPENDENCY_PLACEHOLDERS[draft.language]}
            rows={8}
            disabled={disabled}
            error={dependencyIssues.length > 0}
            spellCheck={false}
            autoComplete='off'
          />
          <p className='text-[var(--text-muted)] text-caption'>
            One per line. Version pins are optional.
          </p>
          {dependencyIssues.length > 0 && (
            <ul className='flex flex-col gap-1'>
              {[...dependencyIssuesByLine.values()].map((issue) => (
                <li key={issue.line} className='text-[var(--text-error)] text-caption'>
                  Line {issue.line}: {issue.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsSection>

      <SettingsSection label='Managed CLI tools'>
        <ManagedCliSelect
          value={draft.cliTools}
          onChange={(cliTools) => onChange({ ...draft, cliTools })}
          disabled={disabled}
          stayBelow
        />
      </SettingsSection>

      <SettingsSection label='System packages'>
        <div className='flex flex-col gap-2'>
          <ChipTextarea
            value={draft.systemPackages}
            onChange={(event) => onChange({ ...draft, systemPackages: event.target.value })}
            placeholder={SYSTEM_PACKAGE_PLACEHOLDER}
            rows={6}
            disabled={disabled}
            error={systemPackageIssues.length > 0}
            spellCheck={false}
            autoComplete='off'
          />
          <p className='text-[var(--text-muted)] text-caption'>
            One Debian/APT package per line. Version pins are optional.
          </p>
          {systemPackageIssues.length > 0 && (
            <ul className='flex flex-col gap-1'>
              {[...systemPackageIssuesByLine.values()].map((issue) => (
                <li key={issue.line} className='text-[var(--text-error)] text-caption'>
                  Line {issue.line}: {issue.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsSection>

      {status && <SettingsSection label='Status'>{status}</SettingsSection>}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  failed: 'Failed',
  building: 'Building',
  pending: 'Queued',
}

interface SandboxStatusProps {
  sandbox: Sandbox
  /** Runtime-strategy deployments have no build to report. */
  strategy: 'prebuilt' | 'runtime'
  onRetry?: () => void
  retrying?: boolean
  retryDisabled?: boolean
}

export function SandboxStatus({
  sandbox,
  strategy,
  onRetry,
  retrying = false,
  retryDisabled = false,
}: SandboxStatusProps) {
  const [showLog, setShowLog] = useState(false)

  if (strategy === 'runtime') {
    return (
      <p className='text-[var(--text-muted)] text-caption'>
        Dependencies, system packages, and managed CLI tools install at run time on this deployment,
        adding startup time per execution. Prebuilt sandboxes require E2B.
      </p>
    )
  }

  const dependencyCount = sandbox.dependencies.length
  const systemPackageCount = sandbox.systemPackages.length
  const cliToolCount = sandbox.cliTools.length

  if (dependencyCount === 0 && systemPackageCount === 0 && cliToolCount === 0) {
    return (
      <p className='text-[var(--text-muted)] text-caption'>
        No dependencies, system packages, or managed CLI tools yet. Add one above to build this
        sandbox; until then it runs on the Function base.
      </p>
    )
  }

  const status = sandbox.buildStatus ?? 'pending'

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <span
          className={cn(
            'text-sm',
            status === 'failed' ? 'text-[var(--text-error)]' : 'text-[var(--text-body)]'
          )}
        >
          {STATUS_LABEL[status]}
        </span>
        <span className='text-[var(--text-muted)] text-caption'>
          · {dependencyCount} {dependencyCount === 1 ? 'dependency' : 'dependencies'} ·{' '}
          {systemPackageCount} {systemPackageCount === 1 ? 'system package' : 'system packages'} ·{' '}
          {cliToolCount} {cliToolCount === 1 ? 'managed CLI' : 'managed CLIs'}
        </span>
        {status === 'failed' && onRetry && (
          <RowActionsMenu
            label={`${sandbox.name} build actions`}
            triggerClassName='ml-auto'
            actions={[
              {
                label: retrying ? 'Retrying...' : 'Retry build',
                onSelect: onRetry,
                disabled: retrying || retryDisabled,
                tooltip: retryDisabled ? 'Save or discard changes before retrying' : undefined,
              },
            ]}
          />
        )}
      </div>

      {status === 'failed' && sandbox.errorMessage && (
        <div className='flex flex-col gap-2'>
          <p className='text-[var(--text-error)] text-caption'>{sandbox.errorMessage}</p>
          {sandbox.errorDetail && (
            <>
              <Chip onClick={() => setShowLog((open) => !open)}>
                {showLog ? 'Hide log' : 'Show log'}
              </Chip>
              {showLog && (
                <pre className='max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] bg-[var(--surface-3)] p-3 text-[var(--text-muted)] text-caption'>
                  {sandbox.errorDetail}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
