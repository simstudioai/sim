import { createVerifyAuth } from '@sim/auth/verify'
import { env } from '@/env'

export const auth = createVerifyAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
})
