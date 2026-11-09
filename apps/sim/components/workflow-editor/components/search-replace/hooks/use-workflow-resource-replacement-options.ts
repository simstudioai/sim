import { useMemo } from 'react'
import type {
  WorkflowSearchMatch,
  WorkflowSearchReplacementOption,
} from '@/lib/workflows/search-replace/types'
import { usePersonalEnvironment, useWorkspaceEnvironment } from '@/hooks/queries/environment'
import {
  flattenWorkflowSearchReplacementOptions,
  useWorkflowSearchFileReplacementOptions,
  useWorkflowSearchKnowledgeReplacementOptions,
  useWorkflowSearchMcpServerReplacementOptions,
  useWorkflowSearchMcpToolReplacementOptions,
  useWorkflowSearchOAuthReplacementOptions,
  useWorkflowSearchSelectorReplacementOptions,
  useWorkflowSearchTableReplacementOptions,
} from '@/hooks/queries/workflow-search-replace'

interface UseWorkflowResourceReplacementOptionsParams {
  matches: WorkflowSearchMatch[]
  workspaceId?: string
  workflowId?: string
  /** What is typed in the replacement picker; files are searched by it rather than listed whole. */
  query: string
  /** Every replacement already chosen, kept on offer so each stays valid. */
  chosen: readonly string[]
}

export function useWorkflowResourceReplacementOptions({
  matches,
  workspaceId,
  workflowId,
  query,
  chosen,
}: UseWorkflowResourceReplacementOptionsParams): WorkflowSearchReplacementOption[] {
  const oauthOptions = useWorkflowSearchOAuthReplacementOptions(matches, workspaceId, workflowId)
  const knowledgeOptions = useWorkflowSearchKnowledgeReplacementOptions(matches, workspaceId)
  const selectorOptions = useWorkflowSearchSelectorReplacementOptions(matches)
  const tableOptions = useWorkflowSearchTableReplacementOptions(matches, workspaceId)
  const fileOptions = useWorkflowSearchFileReplacementOptions(matches, workspaceId, {
    query,
    chosen,
  })
  const mcpServerOptions = useWorkflowSearchMcpServerReplacementOptions(matches, workspaceId)
  const mcpToolOptions = useWorkflowSearchMcpToolReplacementOptions(matches, workspaceId)
  const { data: personalEnvironment } = usePersonalEnvironment()
  const { data: workspaceEnvironment } = useWorkspaceEnvironment(workspaceId ?? '')

  return useMemo(() => {
    const environmentKeys = new Set([
      ...Object.keys(personalEnvironment ?? {}),
      ...Object.keys(workspaceEnvironment?.workspace ?? {}),
    ])
    const environmentOptions: WorkflowSearchReplacementOption[] = [...environmentKeys]
      .sort()
      .map((key) => ({
        kind: 'environment',
        value: `{{${key}}}`,
        label: `{{${key}}}`,
      }))

    return [
      ...environmentOptions,
      ...flattenWorkflowSearchReplacementOptions(oauthOptions),
      ...flattenWorkflowSearchReplacementOptions(knowledgeOptions),
      ...selectorOptions.flatMap((group) => group.data?.items ?? []),
      ...flattenWorkflowSearchReplacementOptions(tableOptions),
      ...flattenWorkflowSearchReplacementOptions(fileOptions),
      ...flattenWorkflowSearchReplacementOptions(mcpServerOptions),
      ...flattenWorkflowSearchReplacementOptions(mcpToolOptions),
    ]
  }, [
    fileOptions,
    knowledgeOptions,
    mcpServerOptions,
    mcpToolOptions,
    oauthOptions,
    personalEnvironment,
    selectorOptions,
    tableOptions,
    workspaceEnvironment,
  ])
}
