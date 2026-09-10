import {
  defineForkUseCase,
  type ForkApplicationContext,
} from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { getForkMappingView } from '@/ee/workspace-forking/lib/mapping/mapping-service'

interface MappingDetailsInput {
  workspaceId: string
  otherWorkspaceId: string
  direction: 'push' | 'pull'
}

export const getWorkspaceForkMappingDetails = defineForkUseCase({
  operation: forkOperations.mappingsRead,
  bothSides: true,
  edge: true,
  async execute({
    input,
    context,
  }: {
    input: MappingDetailsInput
    context: ForkApplicationContext
  }) {
    const edge = context.edge!
    const sourceWorkspaceId =
      input.direction === 'push' ? input.workspaceId : input.otherWorkspaceId
    const targetWorkspaceId =
      input.direction === 'push' ? input.otherWorkspaceId : input.workspaceId
    const { entries } = await getForkMappingView({ edge, sourceWorkspaceId, targetWorkspaceId })
    return {
      childWorkspaceId: edge.childWorkspaceId,
      parentWorkspaceId: edge.parentWorkspaceId,
      sourceWorkspaceId,
      targetWorkspaceId,
      entries,
    }
  },
})
