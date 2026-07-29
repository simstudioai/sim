import { z } from 'zod'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const desktopHandoffTokenResponseSchema = z.object({
  token: z.string().min(1, 'token cannot be empty'),
})

/**
 * Mints the one-time token the desktop app redeems to sign in. Takes no input:
 * the caller is identified by its session cookie, and the handoff state/port
 * are validated by the `/desktop/auth` page that renders the confirm gesture.
 */
export const createDesktopHandoffTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/auth/handoff',
  response: {
    mode: 'json',
    schema: desktopHandoffTokenResponseSchema,
  },
})

export type DesktopHandoffTokenResponse = ContractJsonResponse<
  typeof createDesktopHandoffTokenContract
>
