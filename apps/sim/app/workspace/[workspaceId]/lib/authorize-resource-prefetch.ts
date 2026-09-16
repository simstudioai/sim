import { internalSessionAuth } from '@/lib/api/server/routes'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import type { AuthorizingUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import type { ApplicationOperation } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Prove module access through its application operation before seeding resource data or chrome. */
export async function authorizeResourcePrefetch(
  useCase: Pick<
    AuthorizingUseCase<ApplicationOperation, { workspaceId: string }, unknown>,
    'authorize'
  >,
  workspaceId: string
): Promise<boolean> {
  try {
    const principal = await internalSessionAuth.authenticate()
    await useCase.authorize({ principal, input: { workspaceId } })
    return true
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError) return false
    if (
      error instanceof OrchestrationError &&
      (error.code === 'forbidden' || error.code === 'not_found' || error.code === 'unauthorized')
    )
      return false
    throw error
  }
}
