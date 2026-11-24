import { mothershipBuildNotesInputSchema } from '@/lib/api/contracts/mothership-build-notes'
import {
  applyBuildNotes,
  createBuildNotes,
  evaluateBuildNotes,
  getBuildNotesChanges,
  getBuildNotesStatus,
  rebaseBuildNotes,
} from '@/lib/build-notes/application/build-notes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { executeBuildNotesUseCase } from '@/lib/mothership/application/execute-build-notes-use-case'
import { requireTrustedCopilotExecutionContext } from '@/lib/mothership/auth/application-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
} from '@/lib/mothership/tools/server/base-tool'

const READ_ACTIONS = new Set(['status', 'changes'])

export const buildNotesServerTool: BaseServerTool = {
  name: 'build_notes',
  inputSchema: mothershipBuildNotesInputSchema,
  writes: (args) => !READ_ACTIONS.has(mothershipBuildNotesInputSchema.parse(args).action),
  async execute(raw, context) {
    const input = mothershipBuildNotesInputSchema.parse(raw)
    const trusted = requireTrustedCopilotExecutionContext(context)
    if (input.workspaceId && input.workspaceId !== trusted.workspaceId)
      throw new OrchestrationError('not_found', 'Workspace not found in this invocation')
    assertServerToolNotAborted(context)
    const target = { workflowId: input.workflowId, assertedWorkspaceId: trusted.workspaceId }
    switch (input.action) {
      case 'create':
        return executeBuildNotesUseCase(context, createBuildNotes, target)
      case 'status':
        return executeBuildNotesUseCase(context, getBuildNotesStatus, target)
      case 'evaluate':
        return executeBuildNotesUseCase(context, evaluateBuildNotes, target)
      case 'apply':
        return executeBuildNotesUseCase(context, applyBuildNotes, target)
      case 'changes':
        return executeBuildNotesUseCase(context, getBuildNotesChanges, target)
      case 'rebase':
        return executeBuildNotesUseCase(context, rebaseBuildNotes, target)
    }
  },
}
