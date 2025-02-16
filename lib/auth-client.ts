import { createAuthClient } from 'better-auth/react'

export const client = createAuthClient()
export const { useSession } = client

// Export commonly used hooks and methods
export const { signIn, signUp, signOut } = client
