'use client'

import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  InfoCard,
  InfoCardItem,
  InfoCardList,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/auth-client'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { OAuthReturnContext } from '@/lib/credentials/client-state'
import {
  ADD_CONNECTOR_SEARCH_PARAM,
  clearOAuthReturnContext,
  writeOAuthReturnContext,
} from '@/lib/credentials/client-state'
import { defaultCredentialDisplayName } from '@/lib/credentials/display-name'
import {
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { getScopeDescription, getServiceConfigByProviderId } from '@/lib/oauth/utils'
import {
  MicrosoftDataverseEnvironmentField,
  useMicrosoftDataverseEnvironmentForm,
} from '@/app/workspace/[workspaceId]/components/connect-oauth-modal/microsoft-dataverse-environment'
import { withBrandIcon } from '@/blocks/brand-icon'
import { useCreateCredentialDraft } from '@/hooks/queries/credentials'
import {
  assertMicrosoftDataverseWebOAuthAvailable,
  useConnectMicrosoftDataverseOAuthService,
} from '@/hooks/queries/oauth/microsoft-dataverse-connections'
import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'
import { useScopedCredentials } from '@/hooks/queries/scoped-credentials'

const logger = createLogger('ConnectOAuthModal')

const EMPTY_SCOPES: readonly string[] = []

type ServiceIcon = ComponentType<{ className?: string }>

function initialOAuthClientFields(
  fields: readonly { id: string; options?: readonly { value: string }[] }[] | undefined
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields ?? []) {
    const defaultOption = field.options?.[0]
    if (defaultOption) values[field.id] = defaultOption.value
  }
  return values
}

/** Scopes hidden from the permissions list — always present on Google flows. */
function isHiddenScope(scope: string): boolean {
  return scope.includes('userinfo.email') || scope.includes('userinfo.profile')
}

/**
 * Resolves the display name + icon for an OAuth `provider`/`serviceId` pair,
 * preferring the most specific service entry and falling back to the base
 * provider config, then to the raw provider id. Used when the caller does not
 * supply explicit `serviceName`/`serviceIcon`.
 */
function resolveService(
  provider: OAuthProvider,
  serviceId: string
): { providerName: string; ProviderIcon: ServiceIcon | null } {
  const { baseProvider } = parseProvider(provider)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]
  let providerName = baseProviderConfig?.name || provider
  let ProviderIcon: ServiceIcon | null = baseProviderConfig?.icon ?? null
  if (baseProviderConfig) {
    for (const [key, service] of Object.entries(baseProviderConfig.services)) {
      if (key === serviceId || service.providerId === provider) {
        providerName = service.name
        ProviderIcon = service.icon
        break
      }
    }
  }
  return { providerName, ProviderIcon }
}

interface ConnectOAuthModalBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Canonical provider id (e.g. `google-email`). When omitted it is derived
   * from `serviceId`. Used for the credential draft and return context.
   */
  providerId?: string
  /**
   * Optional explicit display name/icon. When omitted, both are resolved from
   * `provider` + `serviceId`. The integrations catalog supplies these directly;
   * workflow/KB callers rely on resolution.
   */
  serviceName?: string
  serviceIcon?: ServiceIcon
  docsUrl?: string
  /** Used to resolve display metadata and the provider id when not supplied directly. */
  provider?: OAuthProvider
  serviceId?: string
  /** Enables the environment-bound Dynamics 365 OAuth flow. Legacy Dataverse callers omit it. */
  requireDataverseEnvironment?: boolean
  /** Locks an environment-bound connection to the workflow or credential's selected environment. */
  dataverseEnvironmentUrl?: string
}

/**
 * Connect mode. Creates the credential draft and writes the origin-specific
 * OAuth return context before handing off to the provider via
 * {@link useConnectOAuthService}.
 */
type ConnectOAuthModalConnectProps = ConnectOAuthModalBaseProps & {
  mode: 'connect'
  workspaceId?: string
  organizationId?: string
  requiredScopes: readonly string[]
} & (
    | { origin: 'workflow'; workflowId: string; workspaceId: string; organizationId?: never }
    | {
        origin: 'kb-connectors'
        knowledgeBaseId: string
        connectorType?: string
        connectorId?: string
        sourceAccess?: 'members'
      }
    | { origin: 'integrations' }
  )

/**
 * Reauthorize mode. Updates the scopes on an existing credential for
 * `toolName`. `newScopes` are surfaced with a "New" badge. An optional
 * `onConnect` override short-circuits the default provider hand-off.
 */
interface ConnectOAuthModalReauthorizeProps extends ConnectOAuthModalBaseProps {
  mode: 'reauthorize'
  toolName: string
  requiredScopes?: readonly string[]
  newScopes?: readonly string[]
  reconnectTarget?: {
    workspaceId?: string
    organizationId?: string
    credentialId: string
    displayName: string
  }
  returnContext?: Pick<
    Extract<OAuthReturnContext, { origin: 'kb-connectors' }>,
    'origin' | 'knowledgeBaseId' | 'connectorType' | 'connectorId'
  >
  onConnect?: () => Promise<void> | void
}

export type ConnectOAuthModalProps =
  | ConnectOAuthModalConnectProps
  | ConnectOAuthModalReauthorizeProps

/**
 * Unified connect/reauthorize OAuth credential modal (ChipModal UI). Mounted by
 * the integrations catalog, the workflow editor's credential selectors, and the
 * knowledge-base connector flows. After the redirect lands back on
 * `window.location.href`, the host page's OAuth return router consumes the
 * context written here.
 */
export function ConnectOAuthModal(props: ConnectOAuthModalProps) {
  const { open, onOpenChange, mode, docsUrl } = props
  const isConnect = mode === 'connect'

  const declaredProviderId = useMemo(
    () => props.providerId ?? (props.serviceId ? getProviderIdFromServiceId(props.serviceId) : ''),
    [props.providerId, props.serviceId]
  )

  /**
   * Authorization servers this service can be connected through, when it has
   * more than one (Salesforce production vs sandbox). Offered on connect only:
   * a reauthorize must return to the server that issued the credential.
   */
  const { authServerOptions, authServerHint } = useMemo(() => {
    const service = isConnect ? getServiceConfigByProviderId(declaredProviderId) : null
    const labels = service?.providerIdLabels
    if (!service?.additionalProviderIds?.length || !labels) {
      return { authServerOptions: [], authServerHint: undefined }
    }
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
  const requiredScopes = props.requiredScopes ?? EMPTY_SCOPES

  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [oauthClientFields, setOAuthClientFields] = useState<Record<string, string>>({})
  const [oauthClientFieldsOpen, setOAuthClientFieldsOpen] = useState<boolean | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: session } = useSession()
  const userName = session?.user?.name

  const { providerName, ProviderIcon } = useMemo(() => {
    if (props.serviceName && props.serviceIcon) {
      return {
        providerName: props.serviceName,
        ProviderIcon: props.serviceIcon,
      }
    }
    const provider = (props.provider ?? providerId) as OAuthProvider
    return resolveService(provider, props.serviceId ?? providerId)
  }, [props.serviceName, props.serviceIcon, props.provider, props.serviceId, providerId])

  const workspaceId = isConnect ? props.workspaceId : props.reconnectTarget?.workspaceId
  const organizationId = isConnect ? props.organizationId : props.reconnectTarget?.organizationId
  const clientConfiguration = getServiceConfigByProviderId(providerId)?.clientConfiguration
  const oauthClientRedirectUri =
    clientConfiguration?.redirectPath && typeof window !== 'undefined'
      ? new URL(clientConfiguration.redirectPath, window.location.origin).toString()
      : null
  const { data: credentials = [], isPending: credentialsLoading } = useScopedCredentials({
    workspaceId,
    organizationId,
    enabled: Boolean(workspaceId || organizationId) && open,
  })
  const createDraft = useCreateCredentialDraft()
  const connectOAuthService = useConnectOAuthService()
  const connectMicrosoftDataverseOAuthService = useConnectMicrosoftDataverseOAuthService()
  const dataverseEnvironmentForm = useMicrosoftDataverseEnvironmentForm({
    fallbackScopes: requiredScopes,
    lockedEnvironmentUrl: props.dataverseEnvironmentUrl,
    open,
    providerId,
    required: props.requireDataverseEnvironment === true,
  })

  if (oauthClientFieldsOpen !== open) {
    setOAuthClientFieldsOpen(open)
    setOAuthClientFields(open ? initialOAuthClientFields(clientConfiguration?.fields) : {})
  }

  /**
   * Lowercased set of OAuth credential names already in the workspace. Drives
   * both the prefill's auto-numbering and the inline duplicate-name error.
   */
  const takenNames = useMemo(
    () =>
      new Set(
        credentials
          .filter((credential) => credential.type === 'oauth')
          .map((credential) => credential.displayName.toLowerCase())
      ),
    [credentials]
  )

  const newScopes = !isConnect ? (props.newScopes ?? EMPTY_SCOPES) : EMPTY_SCOPES

  const newScopesSet = new Set(newScopes.filter((scope) => !isHiddenScope(scope)))
  const displayScopes = [...dataverseEnvironmentForm.effectiveScopes].filter(
    (scope) => !isHiddenScope(scope)
  )

  if (!isConnect) {
    displayScopes.sort((a, b) => {
      const aIsNew = newScopesSet.has(a)
      const bIsNew = newScopesSet.has(b)
      if (aIsNew && !bIsNew) return -1
      if (!aIsNew && bIsNew) return 1
      return 0
    })
  }

  /**
   * Initialize the connect form once per open session, after credentials have
   * loaded so auto-numbering can see them. The `prefilled` ref ensures session
   * refetches or other prop churn while the modal is open won't overwrite the
   * user's typed value.
   */
  const prefilled = useRef(false)
  useEffect(() => {
    if (!open) {
      prefilled.current = false
      setSelectedProviderId(null)
      return
    }
    if (!isConnect || prefilled.current || credentialsLoading) return
    prefilled.current = true
    setDisplayName(defaultCredentialDisplayName(userName, providerName, takenNames))
    setDescription('')
    setValidationError(null)
    setSubmitError(null)
  }, [open, isConnect, credentialsLoading, userName, providerName, takenNames])

  const existingCredential = useMemo(() => {
    if (!isConnect) return null
    const name = displayName.trim().toLowerCase()
    if (!name || !takenNames.has(name)) return null
    return (
      credentials.find((row) => row.type === 'oauth' && row.displayName.toLowerCase() === name) ??
      null
    )
  }, [isConnect, credentials, displayName, takenNames])

  const handleClose = () => {
    setSubmitError(null)
    onOpenChange(false)
  }

  const handleConnect = async () => {
    setValidationError(null)
    setSubmitError(null)
    let returnContextWritten = false
    try {
      const environmentUrl = dataverseEnvironmentForm.validate()
      if (dataverseEnvironmentForm.enabled && !environmentUrl) return
      if (environmentUrl) assertMicrosoftDataverseWebOAuthAvailable()

      let connectorType: string | undefined
      let draftId: string | undefined
      const quickBooksOAuthClientConfig =
        providerId === 'quickbooks'
          ? {
              clientId: oauthClientFields.clientId?.trim() ?? '',
              clientSecret: oauthClientFields.clientSecret?.trim() ?? '',
              environment:
                oauthClientFields.environment === 'production'
                  ? ('production' as const)
                  : ('sandbox' as const),
              webhookVerifierToken: oauthClientFields.webhookVerifierToken?.trim() ?? '',
            }
          : undefined

      if (clientConfiguration?.fields.some((field) => !oauthClientFields[field.id]?.trim())) {
        setSubmitError('Complete every OAuth app configuration field.')
        return
      }

      if (isConnect) {
        const trimmed = displayName.trim()
        if (!trimmed) {
          setValidationError('Display name is required.')
          return
        }

        const draft = await createDraft.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          providerId,
          displayName: trimmed,
          description: description.trim() || undefined,
          oauthClientConfig: quickBooksOAuthClientConfig,
        })
        draftId = draft.draftId

        const preCount = credentials.filter(
          (c) => c.type === 'oauth' && c.providerId === providerId
        ).length

        const baseContext = {
          displayName: trimmed,
          providerId,
          preCount,
          baselineCredentials: credentials
            .filter(
              (credential) => credential.type === 'oauth' && credential.providerId === providerId
            )
            .map((credential) => ({
              id: credential.id,
              accountId: credential.accountId,
              updatedAt: credential.updatedAt,
            })),
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          requestedAt: Date.now(),
        }

        let returnContext: OAuthReturnContext
        if (props.origin === 'kb-connectors') {
          connectorType = props.connectorId ? undefined : props.connectorType
          returnContext = {
            ...baseContext,
            origin: 'kb-connectors',
            knowledgeBaseId: props.knowledgeBaseId,
            connectorType: props.connectorType,
            connectorId: props.connectorId,
            sourceAccess: props.sourceAccess,
          }
        } else if (props.origin === 'workflow') {
          returnContext = {
            ...baseContext,
            origin: 'workflow',
            workspaceId: props.workspaceId,
            organizationId: undefined,
            workflowId: props.workflowId,
          }
        } else {
          returnContext = { ...baseContext, origin: 'integrations' }
        }

        writeOAuthReturnContext(returnContext)
        returnContextWritten = true
      } else if (props.onConnect) {
        await props.onConnect()
        handleClose()
        return
      } else {
        if (props.reconnectTarget) {
          const draft = await createDraft.mutateAsync({
            ...resourceScopeFields(resourceScopeFromOwner(props.reconnectTarget)),
            providerId,
            credentialId: props.reconnectTarget.credentialId,
            displayName: props.reconnectTarget.displayName,
            oauthClientConfig: quickBooksOAuthClientConfig,
          })
          draftId = draft.draftId

          const providerCredentials = credentials.filter(
            (credential) => credential.type === 'oauth' && credential.providerId === providerId
          )
          writeOAuthReturnContext({
            ...(props.returnContext ?? { origin: 'integrations' as const }),
            displayName: props.reconnectTarget.displayName,
            providerId,
            preCount: providerCredentials.length,
            baselineCredentials: providerCredentials.map((credential) => ({
              id: credential.id,
              accountId: credential.accountId,
              updatedAt: credential.updatedAt,
            })),
            ...resourceScopeFields(resourceScopeFromOwner(props.reconnectTarget)),
            reconnect: true,
            requestedAt: Date.now(),
          })
          returnContextWritten = true
        }

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
      if (connectorType) {
        callbackURL.searchParams.set(ADD_CONNECTOR_SEARCH_PARAM, connectorType)
      }

      if (environmentUrl) {
        await connectMicrosoftDataverseOAuthService.mutateAsync({
          callbackURL: callbackURL.toString(),
          draftId,
          environmentUrl,
        })
      } else {
        await connectOAuthService.mutateAsync({
          providerId,
          callbackURL: callbackURL.toString(),
          draftId,
        })
      }
      handleClose()
    } catch (err: unknown) {
      if (returnContextWritten) clearOAuthReturnContext()
      const message = getErrorMessage(err, 'Failed to start OAuth connection')
      setSubmitError(message)
      logger.error('Failed to connect OAuth service', err)
    }
  }

  const createsDraft = isConnect || (!isConnect && Boolean(props.reconnectTarget))
  const isPending =
    (createsDraft && createDraft.isPending) ||
    connectOAuthService.isPending ||
    connectMicrosoftDataverseOAuthService.isPending
  const isDisabled = isConnect
    ? !displayName.trim() ||
      !dataverseEnvironmentForm.isComplete ||
      Boolean(clientConfiguration?.fields.some((field) => !oauthClientFields[field.id]?.trim())) ||
      isPending ||
      Boolean(existingCredential)
    : !dataverseEnvironmentForm.isComplete ||
      Boolean(clientConfiguration?.fields.some((field) => !oauthClientFields[field.id]?.trim())) ||
      isPending

  const displayNameError =
    validationError ??
    (existingCredential
      ? `An integration named "${existingCredential.displayName}" already exists.`
      : undefined)

  const title = `Connect ${providerName}`

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader
        icon={ProviderIcon ? withBrandIcon(ProviderIcon) : null}
        onClose={handleClose}
      >
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {!isConnect && (
          <p className='text-[var(--text-tertiary)] text-caption'>
            The "{props.toolName}" tool requires access to your account.
          </p>
        )}

        {authServerOptions.length > 0 && (
          <ChipModalField
            type='dropdown'
            title='Environment'
            value={providerId}
            onChange={setSelectedProviderId}
            options={authServerOptions}
            align='start'
            hint={authServerHint}
          />
        )}

        {isConnect && (
          <ChipModalField
            type='input'
            title='Display name'
            value={displayName}
            onChange={(value) => {
              setDisplayName(value)
              if (validationError) setValidationError(null)
            }}
            placeholder='Integration name'
            autoComplete='off'
            required
            error={displayNameError}
          />
        )}

        <MicrosoftDataverseEnvironmentField form={dataverseEnvironmentForm} />

        {oauthClientRedirectUri && (
          <ChipModalField
            type='copy'
            title='Redirect URI'
            value={oauthClientRedirectUri}
            copyLabel='Copy redirect URI'
            required
          />
        )}

        {clientConfiguration?.fields.map((field) =>
          field.options ? (
            <ChipModalField
              key={field.id}
              type='dropdown'
              title={field.label}
              value={oauthClientFields[field.id] ?? ''}
              onChange={(value) =>
                setOAuthClientFields((current) => ({
                  ...current,
                  [field.id]: value,
                }))
              }
              options={[...field.options]}
              placeholder={field.placeholder}
              hint={field.hint}
              required
              align='start'
            />
          ) : (
            <ChipModalField
              key={field.id}
              type='input'
              title={field.label}
              value={oauthClientFields[field.id] ?? ''}
              onChange={(value) =>
                setOAuthClientFields((current) => ({
                  ...current,
                  [field.id]: value,
                }))
              }
              placeholder={field.placeholder}
              inputType={field.secret ? 'password' : 'text'}
              autoComplete={field.secret ? 'new-password' : 'off'}
              required
            />
          )
        )}

        {isConnect && (
          <ChipModalField
            type='textarea'
            title='Description'
            value={description}
            onChange={setDescription}
            placeholder='Optional description'
            maxLength={500}
            minHeight={80}
          />
        )}

        {displayScopes.length > 0 && (
          <ChipModalField type='custom' title='Permissions requested'>
            <InfoCard>
              <InfoCardList>
                {displayScopes.map((scope) => (
                  <InfoCardItem key={scope}>
                    <span className='flex items-center gap-2'>
                      {getScopeDescription(scope, providerId)}
                      {!isConnect && newScopesSet.has(scope) && (
                        <Badge variant='amber' size='sm'>
                          New
                        </Badge>
                      )}
                    </span>
                  </InfoCardItem>
                ))}
              </InfoCardList>
            </InfoCard>
          </ChipModalField>
        )}

        <ChipModalError>{submitError}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={handleClose}
        cancelDisabled={isPending}
        secondaryActions={
          docsUrl
            ? [
                {
                  label: 'Setup guide',
                  onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
                },
              ]
            : undefined
        }
        primaryAction={{
          label: isPending ? 'Connecting...' : 'Connect',
          onClick: handleConnect,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
