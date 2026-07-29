'use client'

import { useMemo, useState } from 'react'
import { Chip, ChipDropdown, ChipInput, ChipTextarea, cn } from '@sim/emcn'
import type { SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import type { Sandbox } from '@/hooks/queries/sandboxes'

const LANGUAGE_OPTIONS = [
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python' },
] as const

/**
 * Placeholders double as the format documentation, so they swap with the
 * language rather than describing one syntax for both.
 */
const PLACEHOLDERS: Record<SandboxLanguage, string> = {
  python: 'google-cloud-bigquery==3.25.0\npyairtable>=3.0\npandas',
  javascript: 'axios@^1.7.0\n@aws-sdk/client-s3\nzod',
}

type SandboxLanguage = Sandbox['language']

export interface SandboxDraft {
  name: string
  language: SandboxLanguage
  /** Raw textarea contents — one dependency per line, comments allowed. */
  dependencies: string
}

export function draftFromSandbox(sandbox: Sandbox): SandboxDraft {
  return {
    name: sandbox.name,
    language: sandbox.language,
    dependencies: sandbox.dependencies.join('\n'),
  }
}

export function emptyDraft(): SandboxDraft {
  return { name: '', language: 'python', dependencies: '' }
}

interface SandboxEditorProps {
  draft: SandboxDraft
  onChange: (draft: SandboxDraft) => void
  /** Server-reported bad lines, addressed to the row the user typed them on. */
  issues: SandboxDependencyIssue[]
  disabled?: boolean
  /** Build status row. Absent for an unsaved sandbox and under the runtime strategy. */
  status?: React.ReactNode
}

export function SandboxEditor({
  draft,
  onChange,
  issues,
  disabled = false,
  status,
}: SandboxEditorProps) {
  const issuesByLine = useMemo(() => {
    const byLine = new Map<number, SandboxDependencyIssue>()
    for (const issue of issues) {
      if (!byLine.has(issue.line)) byLine.set(issue.line, issue)
    }
    return byLine
  }, [issues])

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection label='Details'>
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <span className='text-[var(--text-muted)] text-caption'>Name</span>
            <ChipInput
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              placeholder='bigquery-etl'
              disabled={disabled}
              maxLength={64}
              autoComplete='off'
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <span className='text-[var(--text-muted)] text-caption'>Language</span>
            <ChipDropdown
              value={draft.language}
              onChange={(language) => onChange({ ...draft, language: language as SandboxLanguage })}
              options={LANGUAGE_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              disabled={disabled}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection label='Dependencies'>
        <div className='flex flex-col gap-2'>
          <ChipTextarea
            value={draft.dependencies}
            onChange={(event) => onChange({ ...draft, dependencies: event.target.value })}
            placeholder={PLACEHOLDERS[draft.language]}
            rows={8}
            disabled={disabled}
            error={issues.length > 0}
            spellCheck={false}
            autoComplete='off'
          />
          <p className='text-[var(--text-muted)] text-caption'>
            One per line. Version pins are optional.
          </p>
          {issues.length > 0 && (
            <ul className='flex flex-col gap-1'>
              {[...issuesByLine.values()].map((issue) => (
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
}

export function SandboxStatus({ sandbox, strategy }: SandboxStatusProps) {
  const [showLog, setShowLog] = useState(false)

  if (strategy === 'runtime') {
    return (
      <p className='text-[var(--text-muted)] text-caption'>
        Dependencies install at run time on this deployment, adding roughly 10–30s per execution.
        Prebuilt sandboxes require E2B.
      </p>
    )
  }

  const packageCount = sandbox.dependencies.length

  // A sandbox with no packages declares nothing to build, so it has no registry
  // row — reporting that as "Queued" would describe a build that will never come.
  if (packageCount === 0) {
    return (
      <p className='text-[var(--text-muted)] text-caption'>
        No packages yet. Add dependencies above to build this sandbox; until then it runs on the
        default image.
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
          · {packageCount} {packageCount === 1 ? 'package' : 'packages'}
        </span>
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
