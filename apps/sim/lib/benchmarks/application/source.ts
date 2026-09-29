import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { exportWorkflow } from '@/lib/workflows/application/import-export'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'

const MAX_SOURCE_WORKFLOWS = 50
const MAX_SOURCE_BYTES = 500_000

/** Reads authorized workflow exports with credential and password values removed by the canonical exporter. */
export async function readBenchmarkWorkspace(
  principal: Principal,
  workspaceId: string
): Promise<string> {
  const page = await listWorkflows.execute({
    principal,
    input: {
      workspaceId,
      scope: 'active',
      deployedOnly: false,
      sortBy: 'name',
      sortOrder: 'asc',
      limit: MAX_SOURCE_WORKFLOWS,
    },
  })
  if (page.nextCursorKeys) {
    throw new OrchestrationError(
      'validation',
      `Automatic distillation supports at most ${MAX_SOURCE_WORKFLOWS} workflows. Paste a distilled reference for a larger project.`
    )
  }
  if (page.workflows.length === 0)
    throw new OrchestrationError('validation', 'This workspace has no active workflows to distill')
  const snapshots: string[] = []
  let bytes = 0
  for (const workflow of page.workflows) {
    const exported = await exportWorkflow.execute({
      principal,
      input: { workflowId: workflow.id, includeWorkspaceBindings: true },
    })
    const snapshot = JSON.stringify(exported.payload)
    bytes += Buffer.byteLength(snapshot)
    if (bytes > MAX_SOURCE_BYTES) {
      throw new OrchestrationError(
        'validation',
        'This project is too large for automatic distillation. Paste a distilled reference instead.'
      )
    }
    snapshots.push(snapshot)
  }
  return `[${snapshots.join(',')}]`
}
