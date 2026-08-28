'use client'

import { ChipInput, ChipSelect, Label } from '@sim/emcn'
import type {
  CodexConfigField,
  CodexConfigPatch,
  CodexConfigResolution,
  CodexConfigSource,
} from '@/lib/codex/config'
import { CODEX_MODES } from '@/lib/codex/config'
import { CODEX_MODELS, CODEX_REASONING_EFFORTS } from '@/providers/codex'

const INHERIT = '__inherit__'
const REPOSITORY_DEFAULT = '__repository_default__'
const CUSTOM_BRANCH = '__custom_branch__'

interface CodexConfigEditorProps {
  value: CodexConfigPatch
  inherited: CodexConfigResolution
  onChange: (value: CodexConfigPatch) => void
  disabled?: boolean
}

function displayMode(mode: (typeof CODEX_MODES)[number]): string {
  return mode === 'cloud' ? 'Create PR' : 'Plan'
}

const SOURCE_LABELS: Record<CodexConfigSource, string> = {
  system: 'System default',
  workspace: 'Workspace',
  workflow: 'Workflow',
  'legacy-step': 'Legacy step',
  agent: 'Agent',
  step: 'Step',
}

function replaceField(
  patch: CodexConfigPatch,
  field: CodexConfigField,
  value: CodexConfigPatch[CodexConfigField] | undefined
): CodexConfigPatch {
  const next = { ...patch }
  if (value === undefined) delete next[field]
  else Object.assign(next, { [field]: value })
  return next
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='grid grid-cols-[132px_minmax(0,1fr)] items-center gap-3'>
      <Label className='text-[var(--text-secondary)]'>{label}</Label>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}

/** Editor for one sparse layer; the inherit choice always removes the local key. */
export function CodexConfigEditor({
  value,
  inherited,
  onChange,
  disabled = false,
}: CodexConfigEditorProps) {
  const inheritedOption = (field: CodexConfigField, rendered: string) =>
    `Inherit ${rendered} · ${SOURCE_LABELS[inherited.provenance[field]]}`
  const inheritedConfig = inherited.config
  const baseBranchMode = !Object.hasOwn(value, 'baseBranch')
    ? INHERIT
    : value.baseBranch === null
      ? REPOSITORY_DEFAULT
      : CUSTOM_BRANCH

  return (
    <div className='flex flex-col gap-3'>
      <FieldRow label='Mode'>
        <ChipSelect
          aria-label='Codex mode override'
          fullWidth
          dropdownWidth='trigger'
          align='start'
          value={value.mode ?? INHERIT}
          options={[
            { value: INHERIT, label: inheritedOption('mode', displayMode(inheritedConfig.mode)) },
            ...CODEX_MODES.map((mode) => ({ value: mode, label: displayMode(mode) })),
          ]}
          onChange={(mode) =>
            onChange(
              replaceField(
                value,
                'mode',
                mode === INHERIT ? undefined : (mode as CodexConfigPatch['mode'])
              )
            )
          }
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow label='Model'>
        <ChipSelect
          aria-label='Codex model override'
          fullWidth
          dropdownWidth='trigger'
          align='start'
          value={value.model ?? INHERIT}
          options={[
            { value: INHERIT, label: inheritedOption('model', inheritedConfig.model) },
            ...CODEX_MODELS.map((model) => ({ value: model, label: model })),
          ]}
          onChange={(model) =>
            onChange(
              replaceField(
                value,
                'model',
                model === INHERIT ? undefined : (model as CodexConfigPatch['model'])
              )
            )
          }
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow label='Repository owner'>
        <ChipInput
          aria-label='Repository owner override'
          value={value.owner ?? ''}
          placeholder={
            inheritedConfig.owner
              ? `Inherited from ${SOURCE_LABELS[inherited.provenance.owner]}: ${inheritedConfig.owner}`
              : 'Not configured · enter an owner'
          }
          onChange={(event) =>
            onChange(replaceField(value, 'owner', event.target.value.trim() || undefined))
          }
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow label='Repository'>
        <ChipInput
          aria-label='Repository name override'
          value={value.repo ?? ''}
          placeholder={
            inheritedConfig.repo
              ? `Inherited from ${SOURCE_LABELS[inherited.provenance.repo]}: ${inheritedConfig.repo}`
              : 'Not configured · enter a repository'
          }
          onChange={(event) =>
            onChange(replaceField(value, 'repo', event.target.value.trim() || undefined))
          }
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow label='Base branch'>
        <div className='flex min-w-0 gap-2'>
          <div className='min-w-0 flex-1'>
            <ChipSelect
              aria-label='Base branch override mode'
              fullWidth
              dropdownWidth='trigger'
              align='start'
              value={baseBranchMode}
              options={[
                {
                  value: INHERIT,
                  label: inheritedOption(
                    'baseBranch',
                    inheritedConfig.baseBranch ?? 'repository default'
                  ),
                },
                { value: REPOSITORY_DEFAULT, label: 'Repository default branch' },
                { value: CUSTOM_BRANCH, label: 'Custom branch' },
              ]}
              onChange={(mode) => {
                if (mode === INHERIT) onChange(replaceField(value, 'baseBranch', undefined))
                else if (mode === REPOSITORY_DEFAULT) {
                  onChange(replaceField(value, 'baseBranch', null))
                } else {
                  onChange(replaceField(value, 'baseBranch', inheritedConfig.baseBranch ?? 'main'))
                }
              }}
              disabled={disabled}
            />
          </div>
          {baseBranchMode === CUSTOM_BRANCH && (
            <ChipInput
              aria-label='Custom base branch'
              className='w-[42%]'
              value={value.baseBranch ?? ''}
              onChange={(event) => onChange(replaceField(value, 'baseBranch', event.target.value))}
              disabled={disabled}
            />
          )}
        </div>
      </FieldRow>

      <FieldRow label='Reasoning effort'>
        <ChipSelect
          aria-label='Reasoning effort override'
          fullWidth
          dropdownWidth='trigger'
          align='start'
          value={value.reasoningEffort ?? INHERIT}
          options={[
            {
              value: INHERIT,
              label: inheritedOption('reasoningEffort', inheritedConfig.reasoningEffort),
            },
            ...CODEX_REASONING_EFFORTS.map((effort) => ({ value: effort, label: effort })),
          ]}
          onChange={(effort) =>
            onChange(
              replaceField(
                value,
                'reasoningEffort',
                effort === INHERIT ? undefined : (effort as CodexConfigPatch['reasoningEffort'])
              )
            )
          }
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow label='Shell network'>
        <ChipSelect
          aria-label='Agent shell network override'
          fullWidth
          dropdownWidth='trigger'
          align='start'
          value={value.networkAccess === undefined ? INHERIT : String(value.networkAccess)}
          options={[
            {
              value: INHERIT,
              label: inheritedOption(
                'networkAccess',
                inheritedConfig.networkAccess ? 'Allowed' : 'Blocked'
              ),
            },
            { value: 'false', label: 'Blocked' },
            { value: 'true', label: 'Allowed' },
          ]}
          onChange={(networkAccess) =>
            onChange(
              replaceField(
                value,
                'networkAccess',
                networkAccess === INHERIT ? undefined : networkAccess === 'true'
              )
            )
          }
          disabled={disabled}
        />
      </FieldRow>
    </div>
  )
}
