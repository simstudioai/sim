import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { listWorkspaceCredentials } from '@/lib/credentials/application/list-workspace-credentials'
import { listWorkspaceCustomToolsUseCase } from '@/lib/custom-tools/application/use-cases'
import { listKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'
import { listMcpServersUseCase } from '@/lib/mcp/application/use-cases'
import type { WorkspaceInventory } from '@/lib/mothership/generated/protocol'
import { listSecretsUseCase } from '@/lib/secrets/application/use-cases'
import { listSkillsUseCase } from '@/lib/skills/application/use-cases'
import { listTablesUseCase } from '@/lib/table/application/tables'
import { listWorkflows } from '@/lib/workflows/application/list-workflows'
import { queryWorkspaceFilePage } from '@/lib/workspace-files/application/list-workspace-files'

const logger = createLogger('WorkspaceInventory')

/** One page per world — the v2 page cap — and the orientation names the cut. */
const WORLD_LIMIT = 100
const FILE_LIMIT = 150

/**
 * What exists in the workspace, by name and id, packed with every chat request so the
 * agent orients without a round of listings per world. Same use cases, same principal,
 * same authorization as the v2 listings the agent would otherwise call one by one.
 *
 * Each world is read independently: a world that fails to list is left empty and
 * logged rather than failing the turn — the inventory is orientation, the CLI is truth.
 */
export async function buildWorkspaceInventory(
  principal: Principal,
  workspaceId: string
): Promise<WorkspaceInventory> {
  const truncated: string[] = []
  const cut = (world: string, hasMore: boolean) => {
    if (hasMore) truncated.push(world)
  }
  const world = async <T>(name: string, read: () => Promise<T>, empty: T): Promise<T> => {
    try {
      return await read()
    } catch (error) {
      logger.warn(`Inventory world unavailable: ${name}`, {
        workspaceId,
        error: getErrorMessage(error),
      })
      return empty
    }
  }

  const [
    workflows,
    tables,
    knowledgeBases,
    files,
    skills,
    customTools,
    mcpServers,
    credentials,
    secrets,
  ] = await Promise.all([
    world('workflows', async () => {
      const page = await listWorkflows.execute({
        principal,
        input: {
          workspaceId,
          scope: 'active',
          deployedOnly: false,
          sortBy: 'name',
          sortOrder: 'asc',
          limit: WORLD_LIMIT,
        },
      })
      cut('workflows', page.nextCursorKeys !== null && page.nextCursorKeys !== undefined)
      return page.workflows.map((w) => ({
        id: w.id,
        name: w.name,
        ...(w.folderPath && w.folderPath !== '/' ? { folder: w.folderPath } : {}),
        deployed: Boolean(w.isDeployed),
      }))
    }, []),
    world('tables', async () => {
      const page = await listTablesUseCase.execute({
        principal,
        input: { workspaceId, sortBy: 'name', sortOrder: 'asc', limit: WORLD_LIMIT },
      })
      cut('tables', page.nextKeys !== null && page.nextKeys !== undefined)
      return page.tables.map(({ table }) => ({ id: table.id, name: table.name }))
    }, []),
    world('knowledgeBases', async () => {
      const page = await listKnowledgeBases.execute({
        principal,
        input: { workspaceId, limit: WORLD_LIMIT },
      })
      return page.knowledgeBases.map(({ knowledgeBase }) => ({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
      }))
    }, []),
    world('files', async () => {
      const page = await queryWorkspaceFilePage.execute({
        principal,
        input: {
          workspaceId,
          recursive: true,
          sortBy: 'name',
          sortOrder: 'asc',
          limit: FILE_LIMIT,
        },
      })
      cut('files', page.nextKeys !== null && page.nextKeys !== undefined)
      return page.files.map((f) => {
        const folder = (f.folderPath ?? '').replace(/^\/+|\/+$/g, '')
        return { path: `files/${folder ? `${folder}/` : ''}${f.name}`, size: f.size }
      })
    }, []),
    world('skills', async () => {
      const page = await listSkillsUseCase.execute({
        principal,
        input: { workspaceId, sortBy: 'name', sortOrder: 'asc', limit: WORLD_LIMIT, offset: 0 },
      })
      cut('skills', page.hasMore)
      return page.skills.map((s) => ({ name: s.name }))
    }, []),
    world('customTools', async () => {
      const page = await listWorkspaceCustomToolsUseCase.execute({
        principal,
        input: { workspaceId, limit: WORLD_LIMIT },
      })
      return page.tools.map((t) => ({ id: t.id, title: t.title }))
    }, []),
    world('mcpServers', async () => {
      const page = await listMcpServersUseCase.execute({
        principal,
        input: { workspaceId, limit: WORLD_LIMIT },
      })
      return page.servers.map((m) => ({ id: m.id, name: m.name }))
    }, []),
    world('credentials', async () => {
      const page = await listWorkspaceCredentials.execute({
        principal,
        input: { workspaceId, sortBy: 'displayName', sortOrder: 'asc', limit: WORLD_LIMIT },
      })
      cut('credentials', page.nextCursorKeys !== null && page.nextCursorKeys !== undefined)
      return page.credentials.map((c) => ({
        id: c.id,
        name: c.displayName ?? c.id,
        ...(c.providerId ? { provider: c.providerId } : {}),
        type: c.type,
      }))
    }, []),
    world('secrets', async () => {
      const page = await listSecretsUseCase.execute({
        principal,
        input: { workspaceId, sortBy: 'name', sortOrder: 'asc', limit: WORLD_LIMIT },
      })
      cut('secrets', page.nextCursorKeys !== null && page.nextCursorKeys !== undefined)
      return page.secrets.map((s) => s.envKey ?? s.displayName)
    }, []),
  ])

  return {
    workflows,
    tables,
    knowledgeBases,
    files,
    skills,
    customTools,
    mcpServers,
    credentials,
    secrets,
    truncated,
  }
}
