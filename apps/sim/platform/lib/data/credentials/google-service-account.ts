import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'

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
  workspaceId: string
  onCreated: (credentialId: string) => void
}

/**
 * Adds a Google service account from its JSON key, pasted or read from a `.json` file, and seeds the
 * display name from the key's `client_email`. The key is checked against the same schema the server
 * route applies, so `submit` rejects with that schema's first message before any request is sent.
 * Each opening starts from an empty draft.
 */
export function useGoogleServiceAccount({
  open,
  workspaceId,
  onCreated,
}: UseGoogleServiceAccountOptions) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [wasOpen, setWasOpen] = useState(open)
  const createCredential = useCreateScopedCredential()

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

  const submit = async () => {
    setDraft((current) => ({ ...current, fileError: undefined }))
    const trimmed = draft.jsonInput.trim()
    if (!trimmed) throw new Error('Paste the service account JSON key.')
    const validation = serviceAccountJsonSchema.safeParse(trimmed)
    if (!validation.success) throw new Error(validation.error.issues[0]?.message ?? 'Invalid JSON')
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(resourceScopeFromOwner({ workspaceId })),
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
    isPending,
    confirmDisabled: !draft.jsonInput.trim() || isPending,
    submit,
  }
}
