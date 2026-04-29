import { NextResponse } from 'next/server'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { validateSchema } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getBlacklistedProvidersFromEnv } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const GET = withRouteHandler(async () => {
  const validation = validateSchema(noInputSchema, {})
  if (!validation.success) return validation.response

  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    blacklistedProviders: getBlacklistedProvidersFromEnv(),
  })
})
