import type { WorkspaceKind } from '@sim/workspace-code'
import { fileAdapter } from '@/lib/workspace-source/kinds/files/adapter'
import { knowledgeAdapter } from '@/lib/workspace-source/kinds/knowledge/adapter'
import { skillAdapter } from '@/lib/workspace-source/kinds/skills/adapter'
import { tableAdapter } from '@/lib/workspace-source/kinds/table/adapter'
import { toolAdapter } from '@/lib/workspace-source/kinds/tools/adapter'
import { workflowAdapter } from '@/lib/workspace-source/kinds/workflow/adapter'
import type { KindAdapter } from '@/lib/workspace-source/types'

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
