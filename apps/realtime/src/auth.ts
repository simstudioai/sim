import { createVerifyAuth } from '@sim/auth/verify'
import { env } from '@/env'

export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000'

export const ANONYMOUS_USER = {
  id: ANONYMOUS_USER_ID,
  name: 'Anonymous',
  email: 'anonymous@localhost',
  emailVerified: true,
  image: null,
} as const

export const auth = createVerifyAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
})
