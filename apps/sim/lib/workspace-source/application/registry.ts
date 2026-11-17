import type { WorkspaceKind } from '@sim/workspace-code'
import { fileAdapter } from '@/lib/workspace-source/application/kinds/files/adapter'
import { knowledgeAdapter } from '@/lib/workspace-source/application/kinds/knowledge/adapter'
import { skillAdapter } from '@/lib/workspace-source/application/kinds/skills/adapter'
import { tableAdapter } from '@/lib/workspace-source/application/kinds/table/adapter'
import { toolAdapter } from '@/lib/workspace-source/application/kinds/tools/adapter'
import { workflowAdapter } from '@/lib/workspace-source/application/kinds/workflow/adapter'
import type { KindAdapter } from '@/lib/workspace-source/application/types'

/**
 * Every kind's adapter. Each kind owns its own folder under `kinds/`, so building a kind replaces
 * its adapter file and never edits this one.
 */
export const KIND_ADAPTERS: { readonly [K in WorkspaceKind]: KindAdapter<unknown, unknown> } = {
  'custom-tool': toolAdapter,
  skill: skillAdapter,
  table: tableAdapter,
  'knowledge-base': knowledgeAdapter,
  file: fileAdapter,
  workflow: workflowAdapter,
}
