import { tokenCredentialOAuth } from '@/tools/shared/saved-credentials'

/** incident.io tools take an inline key or a saved incident.io credential. */
export const INCIDENTIO_CREDENTIAL_OAUTH = tokenCredentialOAuth('incidentio', {
  apiKey: 'accessToken',
})
