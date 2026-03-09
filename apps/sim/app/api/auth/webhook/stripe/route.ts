import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Handle Stripe webhooks through better-auth
export const { GET, POST } = toNextJsHandler(auth.handler)
