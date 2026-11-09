import { useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/client'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import {
  ADD_CONNECTOR_SEARCH_PARAM,
  clearOAuthReturnContext,
  type OAuthReturnContext,
  writeOAuthReturnContext,
} from '@/lib/credentials/client-state'
import { defaultCredentialDisplayName } from '@/lib/credentials/display-name'
import { OAUTH_PROVIDERS, type OAuthProvider, parseProvider } from '@/lib/oauth'
import {
  getMicrosoftDataverseIdentityScopes,
  getMicrosoftDataverseOAuthScopes,
  MICROSOFT_DATAVERSE_PROVIDER_ID,
  normalizeMicrosoftDataverseEnvironmentUrl,
} from '@/lib/oauth/microsoft-dataverse'
import { getScopeDescription, getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { useCreateCredentialDraft } from '@/hooks/queries/credentials'
import { useConnectOAuthService } from '@/hooks/queries/oauth/connections'
import {
  assertMicrosoftDataverseWebOAuthAvailable,
  useConnectMicrosoftDataverseOAuthService,
} from '@/hooks/queries/oauth/microsoft-dataverse-connections'
import { useScopedCredentials } from '@/hooks/queries/scoped-credentials'

const logger = createLogger('OAuthConnect')

const EMPTY_SCOPES: readonly string[] = []

/**
 * The page the provider sends the viewer back to, which the return context written before the
 * redirect tells what to do with the new account: a workflow selects it in the block that asked, a
 * knowledge base reopens New connector (or the connector a reconnect restores), and Integrations
 * shows it. A reauthorize returns to a knowledge connector or, otherwise, to Integrations.
 */
type OAuthConnectReturn =
  | { origin: 'workflow'; workflowId: string }
  | {
      origin: 'kb-connectors'
      knowledgeBaseId: string
      /** A new connector's source: New connector reopens with it after the round trip. */
      connectorType?: string
      /** An existing connector, which a reconnect returns to. */
      connectorId?: string
      sourceAccess?: 'members'
    }
  | { origin: 'integrations' }

/** Google flows always carry these; they are not worth a row in the permissions list. */
function isHiddenScope(scope: string): boolean {
  return scope.includes('userinfo.email') || scope.includes('userinfo.profile')
}

/** The service's own name when one matches, else the base provider's. */
function resolveServiceName(provider: OAuthProvider, serviceId: string): string {
  const { baseProvider } = parseProvider(provider)
  const base = OAUTH_PROVIDERS[baseProvider]
  if (!base) return provider
  for (const [key, service] of Object.entries(base.services)) {
    if (key === serviceId || service.providerId === provider) return service.name
  }
  return base.name || provider
}

function initialClientFields(
  fields: readonly { id: string; options?: readonly { value: string }[] }[] | undefined
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields ?? []) {
    const first = field.options?.[0]
    if (first) values[field.id] = first.value
  }
  return values
}

/** One of the service's OAuth app settings the viewer supplies before connecting. */
interface OAuthClientField {
  id: string
  label: string
  placeholder: string
  secret: boolean
  hint?: string
  options?: readonly { value: string; label: string }[]
}

/** A scope the connection requests, described for people, and whether a reauthorize adds it. */
interface OAuthScopeRow {
  scope: string
  description: string
  isNew: boolean
}

/** What opens the connect flow: the account to connect or restore, and where to come back. */
export interface OAuthConnectOptions {
  mode: 'connect' | 'reauthorize'
  /**
   * The workspace or organization that owns the credential. A workflow return needs a workspace;
   * an organization's connections return to its Search source setup or to Integrations.
   */
  scope: ResourceScope
  /** The credential's provider id: the declared one to connect, the issuing one to reauthorize. */
  providerId: string
  /** Resolves the service's name with `serviceId` when `serviceName` is not given. */
  provider?: OAuthProvider
  serviceId?: string
  serviceName?: string
  requiredScopes?: readonly string[]
  /** Scopes a reauthorize adds, listed first and marked new. */
  newScopes?: readonly string[]
  /** The tool whose access a reauthorize restores, named in its explanation. */
  toolName?: string
  /** The credential a reauthorize updates in place. */
  reconnectTarget?: { credentialId: string; displayName: string }
  /** Where the provider sends the viewer back; a reauthorize defaults to Integrations. */
  returnTo?: OAuthConnectReturn
  /** Runs once the form is valid, right before the credential draft and the redirect. */
  onBeforeRedirect?: () => void
  /** Binds a Dynamics 365 connection to one Dataverse environment. */
  requireDataverseEnvironment?: boolean
  /** Locks that environment to the one the workflow or credential already chose. */
  dataverseEnvironmentUrl?: string
}

/**
 * Connects a new OAuth account, or reauthorizes an existing one with the scopes it now needs, as the
 * legacy connect dialog does for workflows, knowledge connectors and Integrations: it creates the
 * credential draft, writes the return context the destination page consumes, and hands the browser
 * to the provider. `connect` resolves once the redirect starts, returns `false` to keep the dialog
 * open on a field error, and rejects with a readable message on failure.
 */
export function useOAuthConnect({
  open,
  mode,
  scope,
  providerId: declaredProviderId,
  provider,
  serviceId,
  serviceName,
  requiredScopes = EMPTY_SCOPES,
  newScopes: newScopesInput,
  toolName,
  reconnectTarget,
  returnTo,
  onBeforeRedirect,
  requireDataverseEnvironment = false,
  dataverseEnvironmentUrl,
}: OAuthConnectOptions & { open: boolean }) {
  const isConnect = mode === 'connect'

  const { authServerOptions, authServerHint } = useMemo(() => {
    const service = isConnect ? getServiceConfigByProviderId(declaredProviderId) : null
    const labels = service?.providerIdLabels
    if (!service?.additionalProviderIds?.length || !labels)
      return { authServerOptions: [], authServerHint: undefined }
    return {
      authServerOptions: [service.providerId, ...service.additionalProviderIds].map((value) => ({
        value,
        label: labels[value] ?? value,
      })),
      authServerHint: service.providerIdPickerHint,
    }
  }, [isConnect, declaredProviderId])

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const providerId = selectedProviderId ?? declaredProviderId

  const [displayName, setDisplayNameState] = useState('')
  const [description, setDescription] = useState('')
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [clientFieldValues, setClientFieldValues] = useState<Record<string, string>>({})
  const [clientFieldsOpen, setClientFieldsOpen] = useState<boolean | null>(null)

  const { data: session } = useSession()
  const userName = session?.user?.name

  const providerName =
    serviceName ??
    resolveServiceName(provider ?? (providerId as OAuthProvider), serviceId ?? providerId)

  const clientConfiguration = getServiceConfigByProviderId(providerId)?.clientConfiguration
  const clientFields: readonly OAuthClientField[] = clientConfiguration?.fields ?? []
  const redirectUri =
    clientConfiguration?.redirectPath && typeof window !== 'undefined'
      ? new URL(clientConfiguration.redirectPath, window.location.origin).toString()
      : null

  if (clientFieldsOpen !== open) {
    setClientFieldsOpen(open)
    setClientFieldValues(open ? initialClientFields(clientConfiguration?.fields) : {})
  }

  const { data: credentials = [], isPending: credentialsLoading } = useScopedCredentials({
    ...resourceScopeFields(scope),
    enabled: open,
  })
  const createDraft = useCreateCredentialDraft()
  const connectOAuthService = useConnectOAuthService()
  const connectDataverseService = useConnectMicrosoftDataverseOAuthService()

  const dataverseEnabled =
    requireDataverseEnvironment && providerId === MICROSOFT_DATAVERSE_PROVIDER_ID
  const dataverseLocked = dataverseEnabled && Boolean(dataverseEnvironmentUrl)
  const [environmentUrl, setEnvironmentUrlState] = useState(
    dataverseEnabled ? (dataverseEnvironmentUrl ?? '') : ''
  )
  const [environmentError, setEnvironmentError] = useState<string | null>(null)
  const environmentSession = `${open}:${dataverseEnabled}:${dataverseEnvironmentUrl ?? ''}`
  const [previousEnvironmentSession, setPreviousEnvironmentSession] = useState(environmentSession)
  if (previousEnvironmentSession !== environmentSession) {
    setPreviousEnvironmentSession(environmentSession)
    setEnvironmentUrlState(open && dataverseEnabled ? (dataverseEnvironmentUrl ?? '') : '')
    setEnvironmentError(null)
  }

  const effectiveScopes = (() => {
    if (!dataverseEnabled) return requiredScopes
    if (!environmentUrl.trim()) return getMicrosoftDataverseIdentityScopes(requiredScopes)
    try {
      return getMicrosoftDataverseOAuthScopes(environmentUrl)
    } catch {
      return requiredScopes
    }
  })()

  const takenNames = useMemo(
    () =>
      new Set(
        credentials
          .filter((credential) => credential.type === 'oauth')
          .map((credential) => credential.displayName.toLowerCase())
      ),
    [credentials]
  )

  const newScopes = isConnect ? EMPTY_SCOPES : (newScopesInput ?? EMPTY_SCOPES)
  const newScopeSet = new Set(newScopes.filter((scope) => !isHiddenScope(scope)))
  const scopeRows: OAuthScopeRow[] = effectiveScopes
    .filter((scope) => !isHiddenScope(scope))
    .map((scope) => ({
      scope,
      description: getScopeDescription(scope, providerId),
      isNew: !isConnect && newScopeSet.has(scope),
    }))
  if (!isConnect) scopeRows.sort((a, b) => Number(b.isNew) - Number(a.isNew))

  const prefilled = useRef(false)
  useEffect(() => {
    if (!open) {
      prefilled.current = false
      setSelectedProviderId(null)
      return
    }
    if (!isConnect || prefilled.current || credentialsLoading) return
    prefilled.current = true
    setDisplayNameState(defaultCredentialDisplayName(userName, providerName, takenNames))
    setDescription('')
    setDisplayNameError(null)
  }, [open, isConnect, credentialsLoading, userName, providerName, takenNames])

  const existingCredential = useMemo(() => {
    if (!isConnect) return null
    const name = displayName.trim().toLowerCase()
    if (!name || !takenNames.has(name)) return null
    return (
      credentials.find(
        (credential) => credential.type === 'oauth' && credential.displayName.toLowerCase() === name
      ) ?? null
    )
  }, [isConnect, credentials, displayName, takenNames])

  const missingClientField = clientFields.some((field) => !clientFieldValues[field.id]?.trim())
  const isPending =
    (isConnect || Boolean(reconnectTarget) ? createDraft.isPending : false) ||
    connectOAuthService.isPending ||
    connectDataverseService.isPending
  const environmentComplete = !dataverseEnabled || environmentUrl.trim().length > 0
  const confirmDisabled = isConnect
    ? !displayName.trim() ||
      !environmentComplete ||
      missingClientField ||
      isPending ||
      Boolean(existingCredential)
    : !environmentComplete || missingClientField || isPending

  const setDisplayName = (value: string) => {
    setDisplayNameState(value)
    setDisplayNameError(null)
  }
  const setEnvironmentUrl = (value: string) => {
    setEnvironmentUrlState(value)
    setEnvironmentError(null)
  }
  const setClientField = (id: string, value: string) =>
    setClientFieldValues((current) => ({ ...current, [id]: value }))

  const validateEnvironment = (): string | undefined => {
    if (!dataverseEnabled) return undefined
    try {
      const normalized = normalizeMicrosoftDataverseEnvironmentUrl(environmentUrl)
      setEnvironmentError(null)
      return normalized
    } catch (error) {
      setEnvironmentError(
        getErrorMessage(error, 'Enter a valid public-cloud Dataverse environment URL.')
      )
      return undefined
    }
  }

  const connect = async (): Promise<boolean | undefined> => {
    setDisplayNameError(null)
    let returnContextWritten = false
    try {
      const normalizedEnvironment = validateEnvironment()
      if (dataverseEnabled && !normalizedEnvironment) return false
      if (normalizedEnvironment) assertMicrosoftDataverseWebOAuthAvailable()

      if (missingClientField) throw new Error('Complete every OAuth app configuration field.')
      const trimmedName = displayName.trim()
      if (isConnect && !trimmedName) {
        setDisplayNameError('Display name is required.')
        return false
      }
      onBeforeRedirect?.()

      const quickBooksClientConfig =
        providerId === 'quickbooks'
          ? {
              clientId: clientFieldValues.clientId?.trim() ?? '',
              clientSecret: clientFieldValues.clientSecret?.trim() ?? '',
              environment:
                clientFieldValues.environment === 'production'
                  ? ('production' as const)
                  : ('sandbox' as const),
              webhookVerifierToken: clientFieldValues.webhookVerifierToken?.trim() ?? '',
            }
          : undefined

      const providerCredentials = credentials.filter(
        (credential) => credential.type === 'oauth' && credential.providerId === providerId
      )
      const baseline = {
        providerId,
        preCount: providerCredentials.length,
        baselineCredentials: providerCredentials.map((credential) => ({
          id: credential.id,
          accountId: credential.accountId,
          updatedAt: credential.updatedAt,
        })),
      }
      const scopeFields = resourceScopeFields(scope)
      let draftId: string | undefined
      let addConnectorType: string | undefined

      if (isConnect) {
        const draft = await createDraft.mutateAsync({
          ...scopeFields,
          providerId,
          displayName: trimmedName,
          description: description.trim() || undefined,
          oauthClientConfig: quickBooksClientConfig,
        })
        draftId = draft.draftId
        const base = {
          ...baseline,
          displayName: trimmedName,
          ...scopeFields,
          requestedAt: Date.now(),
        }
        let context: OAuthReturnContext
        if (returnTo?.origin === 'kb-connectors') {
          addConnectorType = returnTo.connectorId ? undefined : returnTo.connectorType
          context = { ...base, ...returnTo }
        } else if (returnTo?.origin === 'workflow' && scope.kind === 'workspace') {
          context = {
            ...base,
            ...returnTo,
            workspaceId: scope.workspaceId,
            organizationId: undefined,
          }
        } else {
          context = { ...base, origin: 'integrations' }
        }
        writeOAuthReturnContext(context)
        returnContextWritten = true
      } else if (reconnectTarget) {
        const draft = await createDraft.mutateAsync({
          ...scopeFields,
          providerId,
          credentialId: reconnectTarget.credentialId,
          displayName: reconnectTarget.displayName,
          oauthClientConfig: quickBooksClientConfig,
        })
        draftId = draft.draftId
        writeOAuthReturnContext({
          ...(returnTo?.origin === 'kb-connectors'
            ? {
                origin: 'kb-connectors' as const,
                knowledgeBaseId: returnTo.knowledgeBaseId,
                connectorType: returnTo.connectorType,
                connectorId: returnTo.connectorId,
              }
            : { origin: 'integrations' as const }),
          ...baseline,
          displayName: reconnectTarget.displayName,
          ...scopeFields,
          reconnect: true,
          requestedAt: Date.now(),
        })
        returnContextWritten = true
      } else {
        logger.info('Reauthorizing OAuth2', {
          providerId,
          requiredScopes,
          hasNewScopes: newScopes.length > 0,
        })
      }

      const callbackURL = new URL(window.location.href)
      callbackURL.searchParams.delete('error')
      callbackURL.searchParams.delete('error_description')
      callbackURL.searchParams.delete('quickbooks_connected')
      if (addConnectorType)
        callbackURL.searchParams.set(ADD_CONNECTOR_SEARCH_PARAM, addConnectorType)

      if (normalizedEnvironment) {
        await connectDataverseService.mutateAsync({
          callbackURL: callbackURL.toString(),
          draftId,
          environmentUrl: normalizedEnvironment,
        })
      } else {
        await connectOAuthService.mutateAsync({
          providerId,
          callbackURL: callbackURL.toString(),
          draftId,
        })
      }
      return undefined
    } catch (error) {
      if (returnContextWritten) clearOAuthReturnContext()
      logger.error('Failed to connect OAuth service', error)
      throw new Error(getErrorMessage(error, 'Failed to start OAuth connection'))
    }
  }

  const connectorReconnect = !isConnect && returnTo?.origin === 'kb-connectors'
  const updatingAccess = connectorReconnect && newScopes.length > 0
  const actionLabel = connectorReconnect
    ? updatingAccess
      ? 'Update access'
      : 'Reconnect'
    : 'Connect'

  return {
    isConnect,
    title: updatingAccess ? `Update ${providerName} access` : `${actionLabel} ${providerName}`,
    explanation: isConnect
      ? undefined
      : connectorReconnect
        ? updatingAccess
          ? 'Approve the requested permissions to continue syncing.'
          : `Continue to ${providerName} to restore this connection.`
        : `The "${toolName ?? providerName}" tool requires access to your account.`,
    actionLabel,
    authServer: authServerOptions.length
      ? {
          options: authServerOptions,
          hint: authServerHint,
          value: providerId,
          onChange: setSelectedProviderId,
        }
      : null,
    displayName,
    setDisplayName,
    displayNameError:
      displayNameError ??
      (existingCredential
        ? `An integration named "${existingCredential.displayName}" already exists.`
        : undefined),
    description,
    setDescription,
    environment: dataverseEnabled
      ? {
          locked: dataverseLocked,
          value: environmentUrl,
          onChange: setEnvironmentUrl,
          error: environmentError ?? undefined,
        }
      : null,
    redirectUri,
    clientFields,
    clientFieldValues,
    setClientField,
    scopeRows,
    isPending,
    confirmDisabled,
    connect,
  }
}
