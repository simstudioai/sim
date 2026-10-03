import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { createPersonalApiKeyContract } from '@/lib/api/contracts'
import { listPersonalApiKeysContract } from '@/lib/api/contracts/api-keys'
import { parseRequest } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  listPersonalApiKeys,
  personalApiKeyOperations,
} from '@/lib/api-key/application/personal-api-keys'
import { performCreatePersonalApiKey } from '@/lib/api-key/orchestration'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { capabilityRefusal } from '@/lib/permission-groups/capability-assertions'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('ApiKeysAPI')

/**
 * Whether the caller's permission group withholds personal-key management.
 *
 * permission-group-enforced: api_keys.manage — a raw handler with inline
 * queries, which the authorization funnel never sees.
 *
 * Personal keys are user-global and so belong to no workspace, which is why no
 * workspace is named: {@link isCapabilityWithheldForUser} then resolves the
 * organization's default group — the group that governs an organization-level
 * action, the same resolution invitations use.
 */
function personalKeyManagementWithheld(userId: string): Promise<boolean> {
  return isCapabilityWithheldForUser(userId, 'api_keys.manage')
}

export const GET = defineInternalJsonRoute({
  contract: listPersonalApiKeysContract,
  auth: internalSessionAuth,
  operation: personalApiKeyOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing personal-key settings admission',
  }),
  errorPolicy: {
    project: internalOrchestrationErrorPolicy.project,
    unhandled: () => internalErrorResponse(500, { error: 'Failed to fetch API keys' }),
  },
  mapInput: () => ({}),
  useCase: listPersonalApiKeys,
  present: ({ keys }) => ({
    keys: keys.map((key) => ({
      ...key,
      createdAt: key.createdAt.toISOString(),
      lastUsed: key.lastUsed?.toISOString() ?? null,
      expiresAt: key.expiresAt?.toISOString() ?? null,
    })),
  }),
})

// POST /api/users/me/api-keys - Create a new API key
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const withheld = await personalKeyManagementWithheld(userId)
    if (withheld) {
      return NextResponse.json({ error: capabilityRefusal('api_keys.manage') }, { status: 403 })
    }

    const parsed = await parseRequest(createPersonalApiKeyContract, request, {})
    if (!parsed.success) return parsed.response

    const { name } = parsed.data.body

    const result = await performCreatePersonalApiKey({
      userId,
      name,
      actorName: session.user.name,
      actorEmail: session.user.email,
      request,
    })
    if (!result.success || !result.key) {
      const status = result.errorCode === 'conflict' ? 409 : 500
      return NextResponse.json({ error: result.error }, { status })
    }

    captureServerEvent(userId, 'api_key_created', {
      key_name: name,
      scope: 'personal',
    })

    return NextResponse.json({ key: result.key })
  } catch (error) {
    logger.error('Failed to create API key', { error })
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
})
