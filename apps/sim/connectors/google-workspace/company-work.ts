import { z } from 'zod'
import type { GoogleWorkspaceUser } from '@/connectors/google-workspace/users'

/** Directory identity and provider continuation are persisted separately from delegated credentials. */
export interface GoogleCompanyUserWork {
  user: Pick<GoogleWorkspaceUser, 'id' | 'email' | 'customerId'>
  cursor?: string
}

export interface GoogleCompanyCursorAdapter {
  seed: (user: GoogleCompanyUserWork['user']) => string
  /** Retains the exact active page when adopting the former single-user-at-a-time cursor. */
  resume: (cursor: string) => GoogleCompanyUserWork[]
}

/** Validates Google Directory identity before persisted partition context is used for delegation. */
export const googleCompanyUserContextSchema = z.object({
  id: z.string().min(1).max(256),
  email: z.string().email().max(254),
  customerId: z.string().min(1).max(256),
})
