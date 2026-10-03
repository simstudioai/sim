import { db } from '@sim/db'
import { listForkCopyableResources } from '@/lib/workflows/references/resources'
import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'

export const getWorkspaceForkResourceDetails = defineForkUseCase({
  operation: forkOperations.discover,
  availability: true,
  execute: ({ input }: { input: { workspaceId: string } }) =>
    listForkCopyableResources(db, input.workspaceId),
})
