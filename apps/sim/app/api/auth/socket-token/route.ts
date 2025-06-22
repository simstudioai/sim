import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function POST() {
  try {
    const response = await auth.api.generateOneTimeToken({
      headers: await headers(),
    })

    if (!response) {
      return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
    }

    return NextResponse.json({ token: response.token })
  } catch (error) {
    console.error('Error generating one-time token:', error)
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
