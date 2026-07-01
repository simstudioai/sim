import { type NextRequest, NextResponse } from 'next/server'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { validationErrorResponse } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getGitHubStars } from '@/lib/github/stars'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const queryValidation = noInputSchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!queryValidation.success) return validationErrorResponse(queryValidation.error)

  return NextResponse.json({ stars: await getGitHubStars() })
})
