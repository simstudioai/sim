import { mothershipIssuesInputSchema } from '@/lib/api/contracts/mothership-issues'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createIssue, getIssueDetail, requestIssueReview } from '@/lib/issues/application/issues'
import { executeIssueUseCase } from '@/lib/mothership/application/execute-issue-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
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

export const issuesServerTool: BaseServerTool = {
  name: 'issues',
  inputSchema: mothershipIssuesInputSchema,
  async execute(raw, context) {
    const input = mothershipIssuesInputSchema.parse(raw)
    const workspaceId = workspaceFor(input, context)
    switch (input.action) {
      case 'create': {
        const { issue, created } = await executeIssueUseCase(context, createIssue, {
          workspaceId,
          title: input.title,
          body: input.body,
          priority: input.priority,
        })
        const resources: ResourceChange[] = [
          {
            op: 'upsert',
            resource: { type: 'issue', workspaceId, id: issue.key, title: issue.title },
          },
        ]
        return {
          issue: { key: issue.key, title: issue.title, status: issue.status },
          document: `issues/${issue.key}.md`,
          created,
          resources,
        }
      }
      case 'get': {
        const { issue } = await executeIssueUseCase(context, getIssueDetail, {
          workspaceId,
          key: input.key,
        })
        return {
          issue: {
            key: issue.key,
            title: issue.title,
            status: issue.status,
            inboxKind: issue.inboxKind,
            priority: issue.priority,
            reviewSummary: issue.reviewSummary,
          },
          document: `issues/${issue.key}.md`,
        }
      }
      case 'request-review': {
        const { issue } = await executeIssueUseCase(context, requestIssueReview, {
          workspaceId,
          key: input.key,
          summary: input.summary,
        })
        return {
          issue: {
            key: issue.key,
            title: issue.title,
            status: issue.status,
            inboxKind: issue.inboxKind,
            reviewSummary: issue.reviewSummary,
          },
        }
      }
    }
  },
}
