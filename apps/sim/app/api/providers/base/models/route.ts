import { NextResponse } from 'next/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getBaseModelProviders } from '@/providers/utils'

export const GET = withRouteHandler(async () => {
  try {
    const allModels = Object.keys(getBaseModelProviders())
    return NextResponse.json({ models: allModels })
  } catch (error) {
    return NextResponse.json({ models: [], error: 'Failed to fetch models' }, { status: 500 })
  }
})
