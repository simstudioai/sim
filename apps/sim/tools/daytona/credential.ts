import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Daytona tools take an inline key or a saved Daytona credential. */
export const DAYTONA_CREDENTIAL_OAUTH = tokenCredentialOAuth('daytona', { apiKey: 'accessToken' })
