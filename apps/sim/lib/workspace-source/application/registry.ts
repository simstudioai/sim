import type { WorkspaceKind } from '@sim/workspace-code'
import { credentialAdapter } from '@/lib/workspace-source/application/kinds/credentials/adapter'
import { fileAdapter } from '@/lib/workspace-source/application/kinds/files/adapter'
import { knowledgeAdapter } from '@/lib/workspace-source/application/kinds/knowledge/adapter'
import { secretAdapter } from '@/lib/workspace-source/application/kinds/secrets/adapter'
import { skillAdapter } from '@/lib/workspace-source/application/kinds/skills/adapter'
import { tableAdapter } from '@/lib/workspace-source/application/kinds/table/adapter'
import { toolAdapter } from '@/lib/workspace-source/application/kinds/tools/adapter'
import { workflowAdapter } from '@/lib/workspace-source/application/kinds/workflow/adapter'
import type { KindAdapter } from '@/lib/workspace-source/application/types'

/** Every kind's adapter, by kind; each lives in its own folder under `kinds/`. */
export const KIND_ADAPTERS: { readonly [K in WorkspaceKind]: KindAdapter<unknown, unknown> } = {
  secret: secretAdapter,
  credential: credentialAdapter,
  'custom-tool': toolAdapter,
  skill: skillAdapter,
  table: tableAdapter,
  'knowledge-base': knowledgeAdapter,
  file: fileAdapter,
  workflow: workflowAdapter,
}
