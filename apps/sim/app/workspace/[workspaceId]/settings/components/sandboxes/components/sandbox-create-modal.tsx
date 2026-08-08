'use client'

import { useState } from 'react'
import {
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import type { SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ManagedCliSelect } from '@/app/workspace/[workspaceId]/settings/components/sandboxes/components/managed-cli-select'
import {
  DEPENDENCY_PLACEHOLDERS,
  emptyDraft,
  extractIssues,
  LANGUAGE_OPTIONS,
  SANDBOX_UPGRADE_DESCRIPTION,
  SANDBOX_UPGRADE_TITLE,
  type SandboxDraft,
  type SandboxLanguage,
  SYSTEM_PACKAGE_PLACEHOLDER,
  toSubmittedLines,
} from '@/app/workspace/[workspaceId]/settings/components/sandboxes/utils'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsUpgradeNotice } from '@/app/workspace/[workspaceId]/settings/components/settings-upgrade-notice'
import { type Sandbox, useCreateSandbox, useSandboxes } from '@/hooks/queries/sandboxes'

interface SandboxCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Seeds the language of the new sandbox. Pickers scope their list to one
   * language, so without this a sandbox created from a JavaScript block could
   * land in the Python list and never appear.
   */
  defaultLanguage?: SandboxLanguage
  /** Receives the created sandbox so the caller can select it. */
  onCreated?: (sandbox: Sandbox) => void
}

/**
 * Creates a sandbox from wherever one is being picked, so authoring a package
 * list never means leaving the workflow for Settings.
 *
 * Editing stays in Settings — this is deliberately create-only, matching the
 * "Create Skill" / "Create Tool" rows it sits beside.
 */
export function SandboxCreateModal({
  open,
  onOpenChange,
  defaultLanguage,
  onCreated,
}: SandboxCreateModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Keyed off `open` so the list is not fetched by every mounted picker, only by
  // one the user actually opened. It shares the picker's cache entry either way.
  const { data } = useSandboxes(open ? workspaceId : undefined)
  const permissions = useUserPermissionsContext()
  const canAdmin = canMutateWorkspaceSettingsSection('sandboxes', permissions)
  // Assume entitled until the list answers — a flash of the upgrade copy on a
  // workspace that has it would be worse than a late, accurate one.
  const entitled = data?.entitled ?? true

  const createSandbox = useCreateSandbox()

  const [draft, setDraft] = useState<SandboxDraft>(emptyDraft)
  const [dependencyIssues, setDependencyIssues] = useState<SandboxDependencyIssue[]>([])
  const [systemPackageIssues, setSystemPackageIssues] = useState<SandboxDependencyIssue[]>([])
  const [error, setError] = useState<string | null>(null)

  // The modal stays mounted for its exit animation, so each opening has to clear
  // what the last one left behind.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setDraft({ ...emptyDraft(), ...(defaultLanguage ? { language: defaultLanguage } : {}) })
      setDependencyIssues([])
      setSystemPackageIssues([])
      setError(null)
    }
  }

  // A gate answers the whole dialog rather than reddening a form the user can
  // never submit — the same call the settings page makes.
  const gate = !entitled ? 'plan' : !canAdmin ? 'permission' : null
  const saving = createSandbox.isPending

  const handleCreate = async () => {
    setDependencyIssues([])
    setSystemPackageIssues([])
    setError(null)
    try {
      const { sandbox } = await createSandbox.mutateAsync({
        workspaceId,
        name: draft.name.trim(),
        language: draft.language,
        dependencies: toSubmittedLines(draft.dependencies),
        systemPackages: toSubmittedLines(draft.systemPackages),
        cliTools: draft.cliTools,
      })
      onCreated?.(sandbox)
      onOpenChange(false)
    } catch (caught) {
      const lineIssues = extractIssues(caught)
      if (lineIssues) {
        setDependencyIssues(lineIssues.field === 'dependencies' ? lineIssues.issues : [])
        setSystemPackageIssues(lineIssues.field === 'systemPackages' ? lineIssues.issues : [])
        return
      }
      setError(getErrorMessage(caught, 'Failed to create sandbox'))
    }
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Create sandbox'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Create sandbox</ChipModalHeader>

      <ChipModalBody>
        {gate === 'plan' ? (
          <SettingsUpgradeNotice
            title={SANDBOX_UPGRADE_TITLE}
            description={SANDBOX_UPGRADE_DESCRIPTION}
            canUpgrade={canAdmin}
            compact
          />
        ) : gate === 'permission' ? (
          <SettingsEmptyState variant='inline'>
            Only workspace admins can create sandboxes.
          </SettingsEmptyState>
        ) : (
          <>
            <ChipModalField
              type='input'
              title='Name'
              value={draft.name}
              onChange={(name) => setDraft((prev) => ({ ...prev, name }))}
              placeholder='bigquery-etl'
              maxLength={64}
              autoComplete='off'
              required
              disabled={saving}
            />

            <ChipModalField type='custom' title='Language'>
              <ChipDropdown
                value={draft.language}
                onChange={(language) =>
                  setDraft((prev) => ({ ...prev, language: language as SandboxLanguage }))
                }
                options={LANGUAGE_OPTIONS.map((option) => ({
                  label: option.label,
                  value: option.value,
                }))}
                disabled={saving}
                aria-label='Language'
              />
            </ChipModalField>

            <ChipModalField
              type='textarea'
              title='Dependencies'
              value={draft.dependencies}
              onChange={(dependencies) => setDraft((prev) => ({ ...prev, dependencies }))}
              placeholder={DEPENDENCY_PLACEHOLDERS[draft.language]}
              rows={8}
              disabled={saving}
              hint='One per line. Version pins are optional.'
              error={
                dependencyIssues.length > 0 ? (
                  <>
                    {dependencyIssues.map((issue) => (
                      <span key={issue.line} className='block'>
                        Line {issue.line}: {issue.reason}
                      </span>
                    ))}
                  </>
                ) : undefined
              }
            />

            <ChipModalField type='custom' title='Managed CLI tools'>
              <ManagedCliSelect
                value={draft.cliTools}
                onChange={(cliTools) => setDraft((prev) => ({ ...prev, cliTools }))}
                disabled={saving}
              />
            </ChipModalField>

            <ChipModalField
              type='textarea'
              title='System packages'
              value={draft.systemPackages}
              onChange={(systemPackages) => setDraft((prev) => ({ ...prev, systemPackages }))}
              placeholder={SYSTEM_PACKAGE_PLACEHOLDER}
              rows={6}
              disabled={saving}
              hint='One Debian/APT package per line. Version pins are optional.'
              error={
                systemPackageIssues.length > 0 ? (
                  <>
                    {systemPackageIssues.map((issue) => (
                      <span key={issue.line} className='block'>
                        Line {issue.line}: {issue.reason}
                      </span>
                    ))}
                  </>
                ) : undefined
              }
            />

            <ChipModalError>{error}</ChipModalError>
          </>
        )}
      </ChipModalBody>

      {gate === null && (
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={saving}
          primaryAction={{
            label: saving ? 'Creating...' : 'Create',
            onClick: () => void handleCreate(),
            disabled: saving || draft.name.trim().length === 0,
          }}
        />
      )}
    </ChipModal>
  )
}
