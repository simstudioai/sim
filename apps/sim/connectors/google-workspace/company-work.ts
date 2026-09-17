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
