import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { getGoogleKeylessDescriptor } from '@/lib/credentials/config-service-accounts/descriptors'
import { GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'
import { useConfigServiceAccountForm } from '@/platform/lib/data/credentials/config-service-account'

const logger = createLogger('GoogleServiceAccount')

const GOOGLE_SERVICE_ACCOUNT_DOCS_URL = 'https://docs.sim.ai/integrations/google-service-account'

interface GoogleServiceAccountDraft {
  jsonInput: string
  uploadedFileName: string | null
  fileError?: string
  displayName: string
  description: string
}

const EMPTY_DRAFT: GoogleServiceAccountDraft = {
  jsonInput: '',
  uploadedFileName: null,
  displayName: '',
  description: '',
}

/** The key's `client_email`, or nothing while the text is not yet a parsable key. */
function clientEmailOf(text: string): string | undefined {
  try {
    const email = toRecord(JSON.parse(text)).client_email
    return typeof email === 'string' ? email : undefined
  } catch {
    return undefined
  }
}

/** Seeds an empty display name from the key, leaving one the user typed alone. */
function withKey(
  draft: GoogleServiceAccountDraft,
  jsonInput: string,
  uploadedFileName: string | null
): GoogleServiceAccountDraft {
  const displayName = draft.displayName.trim()
    ? draft.displayName
    : (clientEmailOf(jsonInput) ?? draft.displayName)
  return { ...draft, jsonInput, uploadedFileName, fileError: undefined, displayName }
}

interface UseGoogleServiceAccountOptions {
  open: boolean
  /** The workspace or organization that owns the new credential. */
  scope: ResourceScope
  onCreated: (credentialId: string) => void
  /**
   * The OAuth service the dialog is opened for. A Google Cloud service (BigQuery, Vertex AI) also
   * offers keyless Workload Identity Federation; a Google Workspace service never can use it.
   */
  oauthServiceId?: string
}

/**
 * Adds a Google service account from its JSON key, pasted or read from a `.json` file, and seeds the
 * display name from the key's `client_email`. The key is checked against the same schema the server
 * route applies, so `submit` rejects with that schema's first message before any request is sent.
 * For a Google Cloud service, an auth type choice also offers keyless Workload Identity Federation,
 * whose fields and trust values `keylessFields` lists. Each opening starts from an empty draft.
 */
export function useGoogleServiceAccount({
  open,
  scope,
  onCreated,
  oauthServiceId,
}: UseGoogleServiceAccountOptions) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [wasOpen, setWasOpen] = useState(open)
  const createCredential = useCreateScopedCredential()
  const keylessForm = useConfigServiceAccountForm({
    descriptor: getGoogleKeylessDescriptor(oauthServiceId),
    scope,
  })
  const keyless = keylessForm.authType === 'workload_identity'

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(EMPTY_DRAFT)
  }

  const setJsonInput = (value: string) => setDraft((current) => withKey(current, value, null))

  const chooseFile = async (file: File) => {
    if (!file.name.endsWith('.json')) {
      setDraft((current) => ({ ...current, fileError: 'Only .json files are supported' }))
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch (error) {
      logger.warn('Could not read the service account key file', error)
      return
    }
    setDraft((current) => withKey(current, text, file.name))
  }

  const isPending = createCredential.isPending

  const submitKeyless = async (config: Record<string, string>) => {
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(scope),
        type: 'service_account',
        providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
        displayName: draft.displayName.trim() || undefined,
        description: draft.description.trim() || undefined,
        serviceAccountJson: JSON.stringify(config),
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to add keyless Google service account credential', error)
      throw new Error(getErrorMessage(error, 'Could not verify the keyless credential.'))
    }
  }

  const submit = async () => {
    if (keyless) return keylessForm.config ? submitKeyless(keylessForm.config) : false
    setDraft((current) => ({ ...current, fileError: undefined }))
    const trimmed = draft.jsonInput.trim()
    if (!trimmed) throw new Error('Paste the service account JSON key.')
    const validation = serviceAccountJsonSchema.safeParse(trimmed)
    if (!validation.success) throw new Error(validation.error.issues[0]?.message ?? 'Invalid JSON')
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(scope),
        type: 'service_account',
        providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
        displayName: draft.displayName.trim() || undefined,
        description: draft.description.trim() || undefined,
        serviceAccountJson: trimmed,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to add Google service account credential', error)
      throw new Error(getErrorMessage(error, 'Failed to add service account'))
    }
  }

  return {
    jsonInput: draft.jsonInput,
    setJsonInput,
    uploadedFile: draft.uploadedFileName ? { name: draft.uploadedFileName } : undefined,
    fileError: draft.fileError,
    chooseFile,
    displayName: draft.displayName,
    setDisplayName: (displayName: string) => setDraft((current) => ({ ...current, displayName })),
    description: draft.description,
    setDescription: (description: string) => setDraft((current) => ({ ...current, description })),
    docsUrl: GOOGLE_SERVICE_ACCOUNT_DOCS_URL,
    /** The auth type choice and, for keyless, its fields and trust values; empty off Google Cloud. */
    keylessFields: keylessForm.fields,
    setKeylessField: keylessForm.setField,
    /** Keyless is chosen, so the JSON key fields are hidden. */
    keyless,
    isPending,
    confirmDisabled: (keyless ? !keylessForm.config : !draft.jsonInput.trim()) || isPending,
    submit,
  }
}
