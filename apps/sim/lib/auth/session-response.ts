/**
 * The app-facing session shape derived from the Better Auth client response.
 * Lives here (the module that produces it) so both the `useSessionQuery` hook
 * and the `SessionProvider` can import it without a provider ↔ hook import cycle.
 */
export type AppSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    role?: string
    createdAt?: Date
    updatedAt?: Date
  } | null
  session?: {
    id?: string
    userId?: string
    activeOrganizationId?: string
    impersonatedBy?: string | null
  }
} | null

export function extractSessionDataFromAuthClientResult(result: unknown): unknown | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const record = result as Record<string, unknown>

  // Expected shape from better-auth client: { data: <session> }
  if ('data' in record) {
    return (record as { data?: unknown }).data ?? null
  }

  // Fallback for raw session payloads: { user, session }
  if ('user' in record) {
    return record
  }

  return null
}
