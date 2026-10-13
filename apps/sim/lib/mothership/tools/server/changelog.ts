import { mothershipChangelogInputSchema } from '@/lib/api/contracts/mothership-changelog'
import {
  getChangelogRelease,
  listChangelogReleases,
  publishChangelogRelease,
  updateChangelogRelease,
} from '@/lib/changelog/application/changelog'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeChangelogUseCase } from '@/lib/mothership/application/execute-changelog-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/mothership/tools/server/base-tool'

function workspaceFor(input: { workspaceId?: string }, context?: ServerToolContext): string {
  const trusted = requireTrustedCopilotExecutionContext(context)
  if (input.workspaceId && input.workspaceId !== trusted.workspaceId)
    throw new OrchestrationError('not_found', 'Workspace not found in this invocation')
  assertServerToolNotAborted(context)
  return trusted.workspaceId
}

/**
 * A change Sim records without a chat came from the workspace chat publishing it. An organization
 * chat belongs to no workspace, so it is never linked.
 */
function withChat<T extends { chatId?: string }>(changes: T[], context?: ServerToolContext): T[] {
  const chatId = context?.chatOrganizationId ? undefined : context?.chatId
  return chatId
    ? changes.map((change) => ({ ...change, chatId: change.chatId ?? chatId }))
    : changes
}

export const changelogServerTool: BaseServerTool = {
  name: 'changelog',
  inputSchema: mothershipChangelogInputSchema,
  async execute(raw, context) {
    const input = mothershipChangelogInputSchema.parse(raw)
    const workspaceId = workspaceFor(input, context)
    switch (input.action) {
      case 'list':
        return executeChangelogUseCase(context, listChangelogReleases, {
          workspaceId,
          cursor: input.cursor,
        })
      case 'get':
        return executeChangelogUseCase(context, getChangelogRelease, {
          workspaceId,
          releaseId: input.releaseId,
        })
      case 'publish':
        return executeChangelogUseCase(context, publishChangelogRelease, {
          workspaceId,
          title: input.title,
          body: input.body,
          bump: input.bump,
          bumpReason: input.bumpReason,
          changes: withChat(input.changes, context),
        })
      case 'update':
        return executeChangelogUseCase(context, updateChangelogRelease, {
          workspaceId,
          releaseId: input.releaseId,
          expectedRevision: input.expectedRevision,
          title: input.title,
          bumpReason: input.bumpReason,
          version: input.version,
          changes: input.changes && withChat(input.changes, context),
        })
    }
  },
}
