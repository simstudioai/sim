import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Clerk tools take an inline key or a saved Clerk credential. */
export const CLERK_CREDENTIAL_OAUTH = tokenCredentialOAuth('clerk', { secretKey: 'accessToken' })
