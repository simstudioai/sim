'use client'

import { useSession } from '@/lib/auth/client'

/** Who is editing: the collaborative caret's identity, and whether the session has resolved. */
export function useMarkdownSession() {
  const { data: session, isPending } = useSession()
  return {
    userId: session?.user?.id ?? '',
    userName: session?.user?.name?.trim() || 'Collaborator',
    isPending,
  }
}
