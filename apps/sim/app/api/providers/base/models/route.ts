import { NextResponse } from 'next/server'
import { getBaseModelProviders } from '@/providers/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const GET = withRouteHandler(async () => {
  try {
    const allModels = Object.keys(getBaseModelProviders())
    return NextResponse.json({ models: allModels })
  } catch (error) {
    return NextResponse.json({ models: [], error: 'Failed to fetch models' }, { status: 500 })
  }
})
