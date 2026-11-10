'use client'

import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { InlineNotice } from '@sim/emcn/status'
import { useWorkflowScope } from '@/platform/lib/data/workflow-editor'
import {
  CLI_TOOL_GROUPS,
  DEPENDENCY_PLACEHOLDERS,
  LANGUAGE_OPTIONS,
  SANDBOX_UPGRADE_DESCRIPTION,
  SANDBOX_UPGRADE_TITLE,
  type Sandbox,
  type SandboxCliToolId,
  type SandboxLanguage,
  SYSTEM_PACKAGE_PLACEHOLDER,
  useSandboxCreate,
} from '@/platform/lib/data/workflow-editor/selectors'

const CLI_TOOL_OPTIONS = CLI_TOOL_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ value: item.value, label: item.label }))
)

function issueText(issues: readonly { line: number; reason: string }[]): string | undefined {
  if (issues.length === 0) return undefined
  return issues.map((issue) => `Line ${issue.line}: ${issue.reason}`).join('\n')
}

interface SandboxCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Seeds the new sandbox's language from the block it is created for. */
  defaultLanguage?: SandboxLanguage
  /** Receives the created sandbox, so the picker can select it. */
  onCreated: (sandbox: Sandbox) => void
}

/**
 * Creates a sandbox (packages, system packages and managed CLI tools for Function blocks) from the
 * picker that needs one. Without an entitled plan or admin access it explains why instead.
 */
export function SandboxCreateModal({
  open,
  onOpenChange,
  defaultLanguage,
  onCreated,
}: SandboxCreateModalProps) {
  const { workspaceId } = useWorkflowScope()
  const sandbox = useSandboxCreate({ workspaceId, open, defaultLanguage, onCreated })

  if (sandbox.gate)
    return (
      <Modal open={open} onOpenChange={onOpenChange} title='Create sandbox'>
        {sandbox.gate === 'plan' ? (
          <InlineNotice title={SANDBOX_UPGRADE_TITLE} message={SANDBOX_UPGRADE_DESCRIPTION} />
        ) : (
          <InlineNotice message='Only workspace admins can create sandboxes.' />
        )}
      </Modal>
    )

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title='Create sandbox'
      confirmLabel={sandbox.saving ? 'Creating…' : 'Create'}
      confirmDisabled={sandbox.saving || sandbox.draft.name.trim().length === 0}
      pending={sandbox.saving}
      onConfirm={() => sandbox.create()}
    >
      <TextField
        label='Name'
        value={sandbox.draft.name}
        onChange={sandbox.setName}
        placeholder='bigquery-etl'
        maxLength={64}
        autoComplete='off'
        required
        disabled={sandbox.saving}
      />
      <SelectField
        label='Language'
        value={sandbox.draft.language}
        onValueChange={sandbox.setLanguage}
        options={LANGUAGE_OPTIONS}
        disabled={sandbox.saving}
      />
      <TextAreaField
        label='Dependencies'
        value={sandbox.draft.dependencies}
        onChange={sandbox.setDependencies}
        placeholder={DEPENDENCY_PLACEHOLDERS[sandbox.draft.language]}
        defaultSize='expanded'
        error={issueText(sandbox.dependencyIssues)}
        disabled={sandbox.saving}
      />
      <MultiSelect
        label='Managed CLI tools'
        options={CLI_TOOL_OPTIONS}
        value={sandbox.draft.cliTools}
        onValueChange={(values) => sandbox.setCliTools(values as SandboxCliToolId[])}
        placeholder='Select managed CLI tools'
        searchLabel='Search managed CLI tools'
        disabled={sandbox.saving}
      />
      <TextAreaField
        label='System packages'
        value={sandbox.draft.systemPackages}
        onChange={sandbox.setSystemPackages}
        placeholder={SYSTEM_PACKAGE_PLACEHOLDER}
        error={issueText(sandbox.systemPackageIssues)}
        disabled={sandbox.saving}
      />
    </Modal>
  )
}
