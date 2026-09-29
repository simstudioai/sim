import type { Principal, SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { organization, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { isBenchmarkEnabled, requireBenchmarkEnabled } from '@/lib/benchmarks/config'
import type { AuthorizingUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import {
  assertOperationPrincipal,
  type PrincipalScopedOperation,
} from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { verifyEffectiveSuperUser } from '@/lib/permissions/super-user'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'

export async function canUseBenchmarks(userId: string): Promise<boolean> {
  if (!isBenchmarkEnabled()) return false
  return (await verifyEffectiveSuperUser(userId)).effectiveSuperUser
}

/** The initiating admin stays the authenticated principal; no session or cookie is replaced. */
export async function requireBenchmarkOperator(principal: Principal): Promise<SessionPrincipal> {
  requireBenchmarkEnabled()
  if (principal.kind !== 'session' || !(await canUseBenchmarks(principal.userId)))
    throw new OrchestrationError('not_found', 'Benchmark is unavailable')
  return principal
}

export function defineAuthorizedBenchmarkUseCase<
  const O extends PrincipalScopedOperation,
  I extends { organizationId?: string },
  R,
>(definition: {
  operation: O
  execute(args: {
    principal: SessionPrincipal
    input: I
    context: { userId: string }
    request?: OrchestrationRequestContext
  }): Promise<R>
}): AuthorizingUseCase<O, I, R> {
  async function authorize(principal: Principal) {
    assertOperationPrincipal(principal, definition.operation)
    return requireBenchmarkOperator(principal)
  }
  return {
    operation: definition.operation,
    async authorize({ principal }) {
      await authorize(principal)
    },
    async execute({ principal, input, request }) {
      const operator = await authorize(principal)
      const [org] = input.organizationId
        ? await db
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, input.organizationId))
            .limit(1)
        : []
      if (input.organizationId && !org)
        throw new OrchestrationError('not_found', 'Organization not found')
      return runWithOutboundOrganization(org?.id ?? null, () =>
        definition.execute({
          principal: operator,
          input,
          request,
          context: { userId: operator.userId },
        })
      )
    },
  }
}

const targetOperation = defineOrganizationOperation({
  id: 'benchmarks.target.authorize',
  minimumRole: 'member',
  capability: 'copilot.use',
  principalKinds: ['organization_delegated'],
  delegatedServices: ['copilot'],
  delegationAudience: 'sim:benchmark-target',
})

/** An explicit admin grant supplies the Copilot subject; current target permissions still govern it. */
export async function authorizeBenchmarkTarget(
  principal: Principal,
  input: {
    organizationId: string
    runAsUserId: string
  }
) {
  const operator = await requireBenchmarkOperator(principal)
  const [target] = await db
    .select({ id: user.id, banned: user.banned })
    .from(user)
    .where(eq(user.id, input.runAsUserId))
    .limit(1)
  if (!target || target.banned)
    throw new OrchestrationError('not_found', 'Benchmark user is unavailable')
  const targetPrincipal = createTrustedOrganizationCopilotPrincipal(
    {
      userId: target.id,
      organizationId: input.organizationId,
      chatId: `benchmark-selection:${operator.userId}`,
      delegationId: `benchmark-operator:${operator.userId}`,
    },
    { audience: targetOperation.delegationAudience, ttlMs: 60_000 }
  )
  return authorizeOrganizationOperation(targetPrincipal, targetOperation, input)
}

/** Only the server's authorized benchmark orchestration can grant this short-lived source read. */
export async function benchmarkSourcePrincipal(
  principal: Principal,
  input: {
    organizationId: string
    runAsUserId: string
    sourceWorkspaceId: string
  }
) {
  const target = await authorizeBenchmarkTarget(principal, input)
  const operator = await requireBenchmarkOperator(principal)
  return createTrustedCopilotPrincipal(
    {
      userId: target.userId,
      workspaceId: input.sourceWorkspaceId,
      delegationId: `benchmark-operator:${operator.userId}`,
    },
    { audience: WORKFLOW_DELEGATION_AUDIENCE, ttlMs: 12 * 60_000 }
  )
}
