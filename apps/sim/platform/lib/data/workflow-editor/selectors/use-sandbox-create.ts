import { useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  emptyDraft,
  extractIssues,
  type SandboxDraft,
  type SandboxLanguage,
  toSubmittedLines,
} from '@/components/settings/sections/sandboxes/utils'
import type { SandboxCliToolId, SandboxDependencyIssue } from '@/lib/api/contracts/sandboxes'
import { type Sandbox, useCreateSandbox, useSandboxes } from '@/hooks/queries/sandboxes'
import { useUserPermissionsContext } from '@/platform/lib/data/workflow-editor'

interface UseSandboxCreateOptions {
  workspaceId: string
  open: boolean
  /** Seeds the new sandbox's language, so one created off a JavaScript block lands in that list. */
  defaultLanguage?: SandboxLanguage
  onCreated: (sandbox: Sandbox) => void
}

/**
 * Creates a sandbox from the Function block's picker, so authoring a package list never means
 * leaving the workflow. Create only, as Settings owns editing. Sandboxes need an entitled plan and
 * a workspace admin: either gate answers the whole dialog instead of a form that cannot submit.
 */
export function useSandboxCreate({
  workspaceId,
  open,
  defaultLanguage,
  onCreated,
}: UseSandboxCreateOptions) {
  const { data } = useSandboxes(open ? workspaceId : undefined)
  const { canAdmin } = useUserPermissionsContext()
  const entitled = data?.entitled ?? true
  const createSandbox = useCreateSandbox()

  const [draft, setDraft] = useState<SandboxDraft>(emptyDraft)
  const [dependencyIssues, setDependencyIssues] = useState<SandboxDependencyIssue[]>([])
  const [systemPackageIssues, setSystemPackageIssues] = useState<SandboxDependencyIssue[]>([])
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setDraft({ ...emptyDraft(), ...(defaultLanguage ? { language: defaultLanguage } : {}) })
      setDependencyIssues([])
      setSystemPackageIssues([])
    }
  }

  const gate: 'plan' | 'permission' | null = !entitled ? 'plan' : !canAdmin ? 'permission' : null

  const update = <Key extends keyof SandboxDraft>(key: Key, value: SandboxDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  /** Resolves once created, `false` to keep the dialog open on line issues, rejects otherwise. */
  const create = async (): Promise<boolean | undefined> => {
    setDependencyIssues([])
    setSystemPackageIssues([])
    try {
      const { sandbox } = await createSandbox.mutateAsync({
        workspaceId,
        name: draft.name.trim(),
        language: draft.language,
        dependencies: toSubmittedLines(draft.dependencies),
        systemPackages: toSubmittedLines(draft.systemPackages),
        cliTools: draft.cliTools,
      })
      onCreated(sandbox)
      return undefined
    } catch (caught) {
      const lineIssues = extractIssues(caught)
      if (lineIssues) {
        setDependencyIssues(lineIssues.field === 'dependencies' ? lineIssues.issues : [])
        setSystemPackageIssues(lineIssues.field === 'systemPackages' ? lineIssues.issues : [])
        return false
      }
      throw new Error(getErrorMessage(caught, 'Failed to create sandbox'))
    }
  }

  return {
    gate,
    canAdmin,
    draft,
    setName: (name: string) => update('name', name),
    setLanguage: (language: SandboxLanguage) => update('language', language),
    setDependencies: (dependencies: string) => update('dependencies', dependencies),
    setSystemPackages: (systemPackages: string) => update('systemPackages', systemPackages),
    setCliTools: (cliTools: SandboxCliToolId[]) => update('cliTools', cliTools),
    dependencyIssues,
    systemPackageIssues,
    saving: createSandbox.isPending,
    create,
  }
}
