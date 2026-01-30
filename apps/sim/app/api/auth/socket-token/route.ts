import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'

export async function POST() {
  try {
    if (isAuthDisabled) {
      return NextResponse.json({ token: 'anonymous-socket-token' })
    }

    const hdrs = await headers()
    const response = await auth.api.generateOneTimeToken({
      headers: hdrs,
    })

    if (!response?.token) {
      // No token usually means invalid/expired session
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    return NextResponse.json({ token: response.token })
  } catch (error) {
    // Check if it's an auth-related error
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (
      errorMessage.includes('session') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('unauthenticated')
    ) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
