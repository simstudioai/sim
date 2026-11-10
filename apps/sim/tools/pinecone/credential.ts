import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** Pinecone tools take an inline key or a saved Pinecone credential. */
export const PINECONE_CREDENTIAL_OAUTH = tokenCredentialOAuth('pinecone', { apiKey: 'accessToken' })
