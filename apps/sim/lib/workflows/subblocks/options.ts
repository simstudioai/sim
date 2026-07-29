import { fetchPersonalEnvironment, fetchWorkspaceEnvironment } from '@/lib/environment/api'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  environmentKeys,
  PERSONAL_ENVIRONMENT_STALE_TIME,
  WORKSPACE_ENVIRONMENT_STALE_TIME,
} from '@/hooks/queries/environment'
import { getSandboxListQueryOptions, type SandboxListResponse } from '@/hooks/queries/sandboxes'
import { getWorkflowListQueryOptions } from '@/hooks/queries/utils/workflow-list-query'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface SubBlockOption {
  label: string
  id: string
}

/**
 * Loads the active workspace's workflows for multi-select subblocks
 * (`fetchOptions`). Set `excludeActiveWorkflow` for surfaces where selecting
 * the current workflow is meaningless (e.g. the Sim trigger never receives
 * events about itself).
 */
export async function fetchWorkspaceWorkflowOptions(options?: {
  excludeActiveWorkflow?: boolean
}): Promise<SubBlockOption[]> {
  const registry = useWorkflowRegistry.getState()
  const workspaceId = registry.hydration.workspaceId
  if (!workspaceId) return []

  const workflows = await getQueryClient().fetchQuery(
    getWorkflowListQueryOptions(workspaceId, 'active')
  )

  return workflows
    .filter(
      (workflow) => !options?.excludeActiveWorkflow || workflow.id !== registry.activeWorkflowId
    )
    .map((workflow) => ({ id: workflow.id, label: workflow.name }))
}

/**
 * Loads the active workspace's secret NAMES for the Function block's secret-scope
 * picker. Names only — values stay server-side and are injected at execution, the
 * same discipline the copilot's workspace context uses.
 */
export async function fetchWorkspaceSecretNameOptions(): Promise<SubBlockOption[]> {
  const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
  if (!workspaceId) return []

  const [workspace, personal] = await Promise.all([
    getQueryClient().fetchQuery({
      queryKey: environmentKeys.workspace(workspaceId),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        fetchWorkspaceEnvironment(workspaceId, signal),
      staleTime: WORKSPACE_ENVIRONMENT_STALE_TIME,
    }),
    getQueryClient().fetchQuery({
      queryKey: environmentKeys.personal(),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchPersonalEnvironment(signal),
      staleTime: PERSONAL_ENVIRONMENT_STALE_TIME,
    }),
  ])

  // Personal variables shadow workspace ones at execution, so both are offered
  // under one de-duplicated list of names.
  const names = new Set<string>([
    ...Object.keys(workspace?.workspace?.variables ?? {}),
    ...Object.keys(personal ?? {}),
  ])
  return [...names].sort().map((name) => ({ id: name, label: name }))
}

/**
 * Labels a sandbox with its language and package count, marking a build that
 * will not run. The language is in the label because agent tool-input renders
 * this field under a synthetic id where the sibling `language` value is not
 * reachable, so the list cannot be filtered there — showing it lets the author
 * see the mismatch before execution rejects it.
 */
function toSandboxOption(sandbox: {
  id: string
  name: string
  language: string
  dependencies: string[]
  buildStatus: string | null
}): SubBlockOption {
  const count = sandbox.dependencies.length
  const language = sandbox.language === 'python' ? 'Python' : 'JavaScript'
  const suffix = sandbox.buildStatus === 'failed' ? ' · build failed' : ''
  return {
    id: sandbox.id,
    label: `${sandbox.name} · ${language} · ${count} ${count === 1 ? 'package' : 'packages'}${suffix}`,
  }
}

async function loadWorkspaceSandboxes(): Promise<SandboxListResponse['sandboxes']> {
  const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
  if (!workspaceId) return []
  const data = await getQueryClient().fetchQuery(getSandboxListQueryOptions(workspaceId))
  return data.sandboxes
}

/**
 * Loads the sandboxes a Function block can run in, scoped to the language its
 * sibling `language` subblock selects — a Python block must never be offered an
 * npm sandbox. The block re-fetches when `language` changes (`dependsOn`).
 */
export async function fetchWorkspaceSandboxOptions(blockId: string): Promise<SubBlockOption[]> {
  const language = useSubBlockStore.getState().getValue(blockId, 'language')
  const sandboxes = await loadWorkspaceSandboxes()
  return sandboxes
    .filter((sandbox) => !language || sandbox.language === language)
    .map(toSandboxOption)
}

/**
 * Hydrates a stored sandbox id to its label before the option list loads.
 *
 * A selection left over from before a language switch is still shown, flagged
 * rather than hidden. Returning `null` here would drop the field back to its
 * "Default image (no extra packages)" placeholder while the value stayed stored
 * and stayed fatal at execution — the field would read as cleared and the run
 * would still fail, with nothing to point at. Labelling it is what lets the
 * author see what to fix.
 */
export async function fetchWorkspaceSandboxOption(
  blockId: string,
  optionId: string
): Promise<SubBlockOption | null> {
  const language = useSubBlockStore.getState().getValue(blockId, 'language')
  const sandboxes = await loadWorkspaceSandboxes()
  const sandbox = sandboxes.find((candidate) => candidate.id === optionId)
  if (!sandbox) return null

  const option = toSandboxOption(sandbox)
  if (language && sandbox.language !== language) {
    return { ...option, label: `${option.label} · wrong language for this block` }
  }
  return option
}
