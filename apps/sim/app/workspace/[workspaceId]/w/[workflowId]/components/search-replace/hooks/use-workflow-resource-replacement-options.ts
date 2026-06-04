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
}

export function useWorkflowResourceReplacementOptions({
  matches,
  workspaceId,
  workflowId,
}: UseWorkflowResourceReplacementOptionsParams): WorkflowSearchReplacementOption[] {
  const oauthOptions = useWorkflowSearchOAuthReplacementOptions(matches, workspaceId, workflowId)
  const knowledgeOptions = useWorkflowSearchKnowledgeReplacementOptions(matches, workspaceId)
  const selectorOptions = useWorkflowSearchSelectorReplacementOptions(matches)
  const tableOptions = useWorkflowSearchTableReplacementOptions(matches, workspaceId)
  const fileOptions = useWorkflowSearchFileReplacementOptions(matches, workspaceId)
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
      ...flattenWorkflowSearchReplacementOptions(selectorOptions),
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
