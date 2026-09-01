import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { submitCredentialGroupApiKeyContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CredentialGroupApiKeyVerificationError } from '@/lib/credential-groups/api-key-providers/types'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { submitPublicCredentialGroupApiKey } from '@/lib/credential-groups/application/public-enrollment'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import {
  enforceCredentialGroupEnrollmentOAuthRateLimit,
  enforcePublicCredentialGroupIpRateLimit,
} from '@/lib/credential-groups/rate-limit'
import { ManagedApiKeyFormatError } from '@/lib/credentials/managed-api-key'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UNAVAILABLE = 'This invitation is invalid, expired, or has been revoked.'

/**
 * Accepts one API key from an invited person.
 *
 * A JSON route rather than the redirect-based flow its OAuth sibling uses: the submitting
 * form is a client component that renders the rejection inline against the field, so the
 * answer has to come back in the response instead of a query parameter.
 */
export const POST = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; optionId: string }> }
  ) => {
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'api-key-submit')
    if (limited) return limited

    const parsed = await parseRequest(submitCredentialGroupApiKeyContract, request, context)
    if (!parsed.success) return parsed.response
    const { token, optionId } = parsed.data.params

    const principal = await authenticateCredentialGroupEnrollment(token)
    if (!principal) return NextResponse.json({ error: UNAVAILABLE }, { status: 404 })

    const enrollmentLimited = await enforceCredentialGroupEnrollmentOAuthRateLimit(
      principal.enrollmentId
    )
    if (enrollmentLimited) return enrollmentLimited

    try {
      const result = await submitPublicCredentialGroupApiKey.execute({
        principal,
        input: { invitationToken: token, optionId, fields: parsed.data.body.fields },
        request,
      })
      return NextResponse.json(result)
    } catch (error) {
      // The verifier's message names what the provider said and is written for the person
      // holding the invitation, so it is surfaced verbatim rather than flattened to a 500.
      if (error instanceof CredentialGroupApiKeyVerificationError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error instanceof ManagedApiKeyFormatError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error instanceof CredentialGroupOAuthError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode })
      }
      const orchestration = asOrchestrationError(error)
      if (orchestration?.code === 'not_found') {
        return NextResponse.json({ error: UNAVAILABLE }, { status: 404 })
      }
      if (orchestration?.code === 'validation') {
        return NextResponse.json({ error: orchestration.message }, { status: 400 })
      }
      throw error
    }
  }
)
