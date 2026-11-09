import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { isApiClientError } from '@/lib/api/client/errors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import { ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'

const logger = createLogger('OracleDatabaseAccount')

const ORACLE_DATABASE_DOCS_URL = 'https://docs.sim.ai/integrations/oracledb'

interface OracleDatabaseDraft {
  host: string
  port: string
  protocol: string
  connectionType: string
  serviceName: string
  sid: string
  username: string
  password: string
  walletContent: string
  walletPassword: string
  displayName: string
  description: string
}

const EMPTY_DRAFT: OracleDatabaseDraft = {
  host: '',
  port: '1521',
  protocol: 'tcps',
  connectionType: 'serviceName',
  serviceName: '',
  sid: '',
  username: '',
  password: '',
  walletContent: '',
  walletPassword: '',
  displayName: '',
  description: '',
}

interface UseOracleDatabaseAccountOptions {
  open: boolean
  /** The workspace or organization that owns the new credential. */
  scope: ResourceScope
  onCreated: (credentialId: string) => void
}

/**
 * Adds a saved Oracle Net connection: host, port, TCPS or TCP, a service name or SID, the database
 * login and, over TCPS, an optional PEM wallet for mutual TLS. The connection is sent as one JSON
 * document, which the server verifies against the database before storing; `submit` rejects with a
 * duplicate-name or verification message. Each opening starts from an empty draft.
 */
export function useOracleDatabaseAccount({
  open,
  scope,
  onCreated,
}: UseOracleDatabaseAccountOptions) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [wasOpen, setWasOpen] = useState(open)
  const createCredential = useCreateScopedCredential()

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(EMPTY_DRAFT)
  }

  const isPending = createCredential.isPending
  const usesSid = draft.connectionType === 'sid'
  const usesTls = draft.protocol === 'tcps'
  const identifier = usesSid ? draft.sid : draft.serviceName
  const confirmDisabled =
    isPending ||
    !draft.host.trim() ||
    !draft.port.trim() ||
    !identifier.trim() ||
    !draft.username.trim() ||
    !draft.password

  const submit = async () => {
    if (confirmDisabled) return false
    const connection = {
      host: draft.host.trim(),
      port: Number(draft.port),
      protocol: draft.protocol,
      connectionType: draft.connectionType,
      ...(usesSid ? { sid: draft.sid.trim() } : { serviceName: draft.serviceName.trim() }),
      username: draft.username.trim(),
      password: draft.password,
      ...(usesTls && draft.walletContent
        ? {
            walletContent: draft.walletContent,
            ...(draft.walletPassword ? { walletPassword: draft.walletPassword } : {}),
          }
        : {}),
    }
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(scope),
        serviceAccountJson: JSON.stringify(connection),
        displayName: draft.displayName.trim() || undefined,
        description: draft.description.trim() || undefined,
        type: 'service_account',
        providerId: ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to add Oracle Database connection credential', error)
      throw new Error(
        isApiClientError(error) && error.code === 'duplicate_display_name'
          ? 'A credential with that name already exists. Choose a different display name.'
          : 'Could not verify the Oracle Database connection. Check the connection details, network access, and database permissions.'
      )
    }
  }

  return {
    values: draft,
    setField: (field: keyof OracleDatabaseDraft, value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    usesSid,
    showWallet: usesTls,
    showWalletPassword: usesTls && Boolean(draft.walletContent),
    docsUrl: ORACLE_DATABASE_DOCS_URL,
    isPending,
    confirmDisabled,
    submit,
  }
}
