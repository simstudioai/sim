import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'

export function checkInternalApiKey(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  const expectedApiKey = env.INTERNAL_API_SECRET

  if (!expectedApiKey) {
    return { success: false, error: 'Internal API key not configured' }
  }

  if (!apiKey) {
    return { success: false, error: 'API key required' }
  }

  if (apiKey !== expectedApiKey) {
    return { success: false, error: 'Invalid API key' }
  }

  return { success: true }
}
