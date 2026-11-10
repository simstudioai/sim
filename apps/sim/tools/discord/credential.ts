import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Discord tools take an inline key or a saved Discord credential. */
export const DISCORD_CREDENTIAL_OAUTH = tokenCredentialOAuth('discord', { botToken: 'accessToken' })
