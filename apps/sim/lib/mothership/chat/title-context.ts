import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import {
  createCopilotChatPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import { getPublicWorkspace } from '@/lib/workspaces/application/get-public-workspace'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

const logger = createLogger('ChatTitleContext')
const NAME_LIMIT = 120
const CONTEXT_LIMIT = 6000

/** Optional, names-only orientation for the background title request. */
export async function buildChatTitleContext(input: {
  userId?: string
  workspaceId?: string
  organizationId?: string
  chatId?: string
  inventory?: unknown
}): Promise<string | undefined> {
  if (!input.userId) return undefined
  try {
    if (input.organizationId && !input.workspaceId && input.chatId) {
      const { workspaces } = await listOrganizationWorkspaces.execute({
        principal: createTrustedOrganizationCopilotPrincipal(
          {
            userId: input.userId,
            organizationId: input.organizationId,
            chatId: input.chatId,
            delegationId: `title:${input.chatId}`,
          },
          { audience: 'sim:workspaces', ttlMs: 60_000 }
        ),
        input: { organizationId: input.organizationId, limit: 12 },
      })
      return boundedSnapshot('organization', undefined, {
        workspaces: workspaces.map(({ name }) => name),
      })
    }
    if (!input.workspaceId || input.organizationId) return undefined
    const { workspace } = await getPublicWorkspace.execute({
      principal: createCopilotChatPrincipal(
        { userId: input.userId, workspaceId: input.workspaceId, chatId: input.chatId },
        'sim:workspaces'
      ),
      input: { workspaceId: input.workspaceId },
    })
    const parsed = ChatPayloadSchema.shape.inventory.safeParse(input.inventory)
    const inventory = parsed.success ? parsed.data : undefined
    return boundedSnapshot('workspace', workspace.name, {
      workflows: inventory?.workflows.map(({ name }) => name) ?? [],
      tables: inventory?.tables.map(({ name }) => name) ?? [],
      knowledgeBases: inventory?.knowledgeBases.map(({ name }) => name) ?? [],
      files: inventory?.files.map(({ path }) => path) ?? [],
      skills: inventory?.skills.map(({ name }) => name) ?? [],
      customTools: inventory?.customTools.map(({ title }) => title) ?? [],
      mcpServers: inventory?.mcpServers.map(({ name }) => name) ?? [],
    })
  } catch {
    logger.warn('Title context metadata unavailable')
    return undefined
  }
}

/** Bound the serialized size too, since names may contain JSON escape characters. */
function boundedSnapshot(
  scope: string,
  workspaceName: string | undefined,
  groups: Record<string, string[]>
): string {
  const snapshot = {
    scope,
    ...(workspaceName ? { workspaceName: truncate(workspaceName, NAME_LIMIT) } : {}),
    partial: true,
    resources: {} as Record<string, string[]>,
  }
  for (const [kind, names] of Object.entries(groups)) {
    if (!names.length) continue
    const selected: string[] = []
    snapshot.resources[kind] = selected
    for (const name of names.slice(0, 12)) {
      selected.push(truncate(name, NAME_LIMIT))
      if (JSON.stringify(snapshot).length > CONTEXT_LIMIT) {
        selected.pop()
        break
      }
    }
    if (!selected.length) delete snapshot.resources[kind]
  }
  return JSON.stringify(snapshot)
}
