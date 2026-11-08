import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { isApiClientError } from '@/lib/api/client/errors'
import type { AtlassianProduct } from '@/lib/api/contracts/credentials'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { getServiceAccountCoverageSentence } from '@/lib/integrations/credential-display'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'

const logger = createLogger('AtlassianServiceAccount')

const ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL =
  'https://docs.sim.ai/integrations/atlassian-service-account'

/** A site domain that does not look like `<tenant>.atlassian.net` gets a warning on the field. */
const ATLASSIAN_DOMAIN_HINT_REGEX = /^[a-z0-9-]+\.atlassian\.net$/i

/**
 * States the token's reach up front. It sits on the API token field rather than Site domain, so it
 * stays visible while the domain field shows its warning. Derived from the catalog so it cannot
 * drift as Atlassian integrations are added.
 */
const ATLASSIAN_COVERAGE_HINT =
  getServiceAccountCoverageSentence(ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) ?? undefined

const CONFLUENCE_TOKEN_HINT =
  'Use a service-account token with Confluence access. Required scopes are listed in the setup guide.'

/** The Atlassian service-account route's `error.code` values, in the terms the user can act on. */
const ATLASSIAN_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "We couldn't authenticate with that API token. Double-check the token and that the service account has access to this site.",
  site_not_found:
    "We couldn't find an Atlassian site at that domain. Check the spelling — it should look like your-team.atlassian.net.",
  duplicate_display_name: 'A credential with that name already exists in this workspace.',
  atlassian_unavailable:
    "We couldn't reach Atlassian to verify these credentials. Try again in a moment.",
}

const FALLBACK_ERROR_MESSAGE = "We couldn't add this service account. Try again in a moment."

function normalizeAtlassianDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

function messageForAtlassianError(error: unknown): string {
  if (isApiClientError(error) && error.code && ATLASSIAN_ERROR_MESSAGES[error.code]) {
    return ATLASSIAN_ERROR_MESSAGES[error.code]
  }
  return FALLBACK_ERROR_MESSAGE
}

interface AtlassianServiceAccountDraft {
  apiToken: string
  domain: string
  displayName: string
  description: string
}

const EMPTY_DRAFT: AtlassianServiceAccountDraft = {
  apiToken: '',
  domain: '',
  displayName: '',
  description: '',
}

interface UseAtlassianServiceAccountOptions {
  open: boolean
  workspaceId: string
  /** The product the setup was opened from, recorded on the credential and naming its token hint. */
  atlassianProduct?: AtlassianProduct
  /** A product-specific setup guide, in place of the Atlassian service-account guide. */
  setupGuideUrl?: string
  onCreated: (credentialId: string) => void
}

/**
 * Adds an Atlassian service account from an API token and site domain. The domain is normalized
 * (scheme and trailing slashes dropped) and warned about when it does not look like an Atlassian
 * site; the server verifies the token against that site, and `submit` rejects with the route's
 * `error.code` in readable terms. Each opening starts from an empty draft.
 */
export function useAtlassianServiceAccount({
  open,
  workspaceId,
  atlassianProduct,
  setupGuideUrl = ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL,
  onCreated,
}: UseAtlassianServiceAccountOptions) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [wasOpen, setWasOpen] = useState(open)
  const createCredential = useCreateScopedCredential()

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(EMPTY_DRAFT)
  }

  const setField = (field: keyof AtlassianServiceAccountDraft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }))

  const trimmedToken = draft.apiToken.trim()
  const normalizedDomain = normalizeAtlassianDomain(draft.domain)
  const showDomainHint =
    normalizedDomain.length > 0 && !ATLASSIAN_DOMAIN_HINT_REGEX.test(normalizedDomain)
  const isPending = createCredential.isPending
  const confirmDisabled = !trimmedToken || !normalizedDomain || isPending

  const submit = async () => {
    if (confirmDisabled) return false
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(resourceScopeFromOwner({ workspaceId })),
        type: 'service_account',
        providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
        apiToken: trimmedToken,
        domain: normalizedDomain,
        atlassianProduct,
        displayName: draft.displayName.trim() || undefined,
        description: draft.description.trim() || undefined,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to add Atlassian service account credential', error)
      throw new Error(messageForAtlassianError(error))
    }
  }

  return {
    apiToken: draft.apiToken,
    setApiToken: (value: string) => setField('apiToken', value),
    apiTokenHint:
      atlassianProduct === 'confluence' ? CONFLUENCE_TOKEN_HINT : ATLASSIAN_COVERAGE_HINT,
    domain: draft.domain,
    setDomain: (value: string) => setField('domain', value),
    domainError: showDomainHint
      ? 'Atlassian sites usually look like your-team.atlassian.net.'
      : undefined,
    displayName: draft.displayName,
    setDisplayName: (value: string) => setField('displayName', value),
    description: draft.description,
    setDescription: (value: string) => setField('description', value),
    docsUrl: setupGuideUrl,
    isPending,
    confirmDisabled,
    submit,
  }
}
