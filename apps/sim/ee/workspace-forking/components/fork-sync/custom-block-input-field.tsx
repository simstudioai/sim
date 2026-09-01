'use client'

import { useMemo } from 'react'
import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'
import {
  buildWorkflowReferenceScope,
  WorkflowReferenceScopeProvider,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/workflow-reference-scope'
import { ReferenceInput } from '@/ee/workspace-forking/components/fork-sync/reference-input'
import { useWorkflowState } from '@/hooks/queries/workflows'

interface CustomBlockInputFieldProps {
  field: ForkDependentReconfig
  value: string
  onChange: (value: string) => void
  /** The workspace being written into — scopes the `{{secret}}` suggestions. */
  targetWorkspaceId: string
  /** JSON-valued (`object` / `array`) fields get the multi-line editor. */
  multiline?: boolean
}

/**
 * One text-valued input of a repointed custom block, with the canvas's own `{{secret}}` and
 * `<block.output>` autocompletes pointed at the environment the value is being written into.
 *
 * The suggestions come from the TARGET side on purpose. A value configured here is applied to
 * the target workspace's copy of the workflow, so it has to resolve there: a secret the user
 * can see in the workspace they are looking at may not exist in the other one, and a block
 * reference means whatever the hosting workflow calls that block.
 *
 * The hosting workflow is fetched by id rather than read from the editor stores, which hold
 * the workflow open on the canvas — on this page, none.
 */
export function CustomBlockInputField({
  field,
  value,
  onChange,
  targetWorkspaceId,
  multiline,
}: CustomBlockInputFieldProps) {
  const { data: hostWorkflow } = useWorkflowState(field.targetWorkflowId)

  const scope = useMemo(
    () =>
      buildWorkflowReferenceScope({
        workflowId: field.targetWorkflowId,
        blocks: hostWorkflow?.blocks,
        edges: hostWorkflow?.edges,
        loops: hostWorkflow?.loops,
        parallels: hostWorkflow?.parallels,
        referencingBlockId: field.targetBlockId,
      }),
    [field.targetWorkflowId, field.targetBlockId, hostWorkflow]
  )

  return (
    <WorkflowReferenceScopeProvider scope={scope}>
      <ReferenceInput
        value={value}
        onChange={onChange}
        multiline={multiline}
        placeholder={multiline ? `Enter ${field.title} as JSON` : `Enter ${field.title}`}
        workspaceId={targetWorkspaceId}
        blockId={field.targetBlockId}
        aria-label={field.title}
      />
    </WorkflowReferenceScopeProvider>
  )
}
