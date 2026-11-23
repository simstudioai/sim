import type { WorkspaceKind } from '@sim/workspace-code'
import { credentialAdapter } from '@/lib/workspace-source/application/kinds/credentials/adapter'
import { deploymentAdapter } from '@/lib/workspace-source/application/kinds/deployment/adapter'
import { fileAdapter } from '@/lib/workspace-source/application/kinds/files/adapter'
import { knowledgeAdapter } from '@/lib/workspace-source/application/kinds/knowledge/adapter'
import { mcpAdapter } from '@/lib/workspace-source/application/kinds/mcp/adapter'
import { secretAdapter } from '@/lib/workspace-source/application/kinds/secrets/adapter'
import { skillAdapter } from '@/lib/workspace-source/application/kinds/skills/adapter'
import { tableAdapter } from '@/lib/workspace-source/application/kinds/table/adapter'
import { toolAdapter } from '@/lib/workspace-source/application/kinds/tools/adapter'
import { workflowAdapter } from '@/lib/workspace-source/application/kinds/workflow/adapter'
import type { KindAdapter } from '@/lib/workspace-source/application/types'

/** Every kind's adapter, by kind; each lives in its own folder under `kinds/`. */
const KIND_ADAPTERS: { readonly [K in WorkspaceKind]: KindAdapter<K, unknown> } = {
  secret: secretAdapter,
  credential: credentialAdapter,
  'custom-tool': toolAdapter,
  skill: skillAdapter,
  'mcp-server': mcpAdapter,
  table: tableAdapter,
  'knowledge-base': knowledgeAdapter,
  file: fileAdapter,
  workflow: workflowAdapter,
  deployment: deploymentAdapter,
}

/** The adapter of `kind`, typed by it, so its methods take that kind's changes. */
export function adapterOf<K extends WorkspaceKind>(kind: K): KindAdapter<K, unknown> {
  return KIND_ADAPTERS[kind]
}
