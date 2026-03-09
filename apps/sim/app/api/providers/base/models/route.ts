import { NextResponse } from 'next/server'
import { getBaseModelProviders } from '@/providers/utils'

export async function GET() {
  try {
    const allModels = Object.keys(getBaseModelProviders())
    return NextResponse.json({ models: allModels })
  } catch (error) {
    return NextResponse.json({ models: [], error: 'Failed to fetch models' }, { status: 500 })
  }
}
