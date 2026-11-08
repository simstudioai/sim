import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'

const logger = createLogger('OciApiKey')

const OCI_API_KEY_DOCS_URL =
  'https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm'

interface OciApiKeyDraft {
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase: string
  region: string
  displayName: string
  description: string
}

const EMPTY_DRAFT: OciApiKeyDraft = {
  tenancyOcid: '',
  userOcid: '',
  fingerprint: '',
  privateKey: '',
  privateKeyPassphrase: '',
  region: '',
  displayName: '',
  description: '',
}

interface UseOciApiKeyOptions {
  open: boolean
  workspaceId: string
  onCreated: (credentialId: string) => void
}

/**
 * Adds an Oracle Cloud API signing key: tenancy and user OCIDs, the key's fingerprint, the PEM
 * private key with its optional passphrase, and the home region. The private key and passphrase
 * are sent exactly as entered; the server checks the key with a bounded OCI request before it is
 * stored, and `submit` rejects with that failure's message. Each opening starts from an empty draft.
 */
export function useOciApiKey({ open, workspaceId, onCreated }: UseOciApiKeyOptions) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [wasOpen, setWasOpen] = useState(open)
  const createCredential = useCreateScopedCredential()

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(EMPTY_DRAFT)
  }

  const isPending = createCredential.isPending
  const confirmDisabled =
    !draft.tenancyOcid.trim() ||
    !draft.userOcid.trim() ||
    !draft.fingerprint.trim() ||
    !draft.privateKey.trim() ||
    !draft.region.trim() ||
    isPending

  const submit = async () => {
    if (confirmDisabled) return false
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(resourceScopeFromOwner({ workspaceId })),
        type: 'service_account',
        providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
        tenancyOcid: draft.tenancyOcid.trim(),
        userOcid: draft.userOcid.trim(),
        fingerprint: draft.fingerprint.trim(),
        privateKey: draft.privateKey,
        ...(draft.privateKeyPassphrase.length > 0
          ? { privateKeyPassphrase: draft.privateKeyPassphrase }
          : {}),
        region: draft.region.trim(),
        displayName: draft.displayName.trim() || undefined,
        description: draft.description.trim() || undefined,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to add OCI API-key credential', error)
      throw new Error(getErrorMessage(error, 'Failed to add OCI API-key credential'))
    }
  }

  return {
    values: draft,
    setField: (field: keyof OciApiKeyDraft, value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    docsUrl: OCI_API_KEY_DOCS_URL,
    isPending,
    confirmDisabled,
    submit,
  }
}
