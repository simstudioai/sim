'use client'

import { type ComponentType, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useTranslations } from 'next-intl'
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
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import type { OAuthReturnContext } from '@/lib/credentials/client-state'
import { ADD_CONNECTOR_SEARCH_PARAM, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getProviderIdFromServiceId,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  parseProvider,
} from '@/lib/oauth'
import { getScopeDescription } from '@/lib/oauth/utils'
import { useCreateCredentialDraft, useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useConnectOAuthService } from '@/hooks/queries/oauth/oauth-connections'

const logger = createLogger('ConnectOAuthModal')

/** Server-enforced max for `WorkspaceCredential.displayName` — see `lib/api/contracts/credentials.ts`. */
const DISPLAY_NAME_MAX_LENGTH = 255

/**
 * Reserved tail budget when truncating the username so the auto-numbering
 * disambiguator (e.g. `" 9999"`) always fits within {@link DISPLAY_NAME_MAX_LENGTH}.
 */
const COLLISION_SUFFIX_RESERVATION = 5

/** Upper bound for the auto-numbering search — pathological if ever reached. */
const MAX_COLLISION_INDEX = 10000

const EMPTY_SCOPES: readonly string[] = []

type ServiceIcon = ComponentType<{ className?: string }>

/** Scopes hidden from the permissions list — always present on Google flows. */
function isHiddenScope(scope: string): boolean {
  return scope.includes('userinfo.email') || scope.includes('userinfo.profile')
}

/**
 * Default credential display name. Produces `"{Name}'s {Service}"` when the
 * user's name is known, falling back to `"My {Service}"` otherwise. The
 * username is truncated so the full string (including any auto-numbering
 * disambiguator) stays within {@link DISPLAY_NAME_MAX_LENGTH}.
 *
 * When the base name collides with an existing credential in `takenNames`,
 * `" 2"`, `" 3"`, ... are appended until an unused name is found. Comparison
 * is case-insensitive to match the duplicate-detection used elsewhere in the
 * modal.
 */
function defaultDisplayName(
  userName: string | null | undefined,
  serviceName: string,
  takenNames: ReadonlySet<string>
): string {
  const trimmed = userName?.trim()
  let base: string
  if (trimmed) {
    const suffix = `'s ${serviceName}`
    const nameBudget = Math.max(
      0,
      DISPLAY_NAME_MAX_LENGTH - suffix.length - COLLISION_SUFFIX_RESERVATION
    )
    const safeName = trimmed.length > nameBudget ? trimmed.slice(0, nameBudget) : trimmed
    base = `${safeName}${suffix}`
  } else {
    base = `My ${serviceName}`
  }

  if (!takenNames.has(base.toLowerCase())) return base
  for (let n = 2; n < MAX_COLLISION_INDEX; n++) {
    const candidate = `${base} ${n}`
    if (!takenNames.has(candidate.toLowerCase())) return candidate
  }
  return base
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
): { providerName: string; ProviderIcon: ServiceIcon } {
  const { baseProvider } = parseProvider(provider)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]
  let providerName = baseProviderConfig?.name || provider
  let ProviderIcon: ServiceIcon = baseProviderConfig?.icon || (() => null)
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
  /** Used to resolve display metadata and the provider id when not supplied directly. */
  provider?: OAuthProvider
  serviceId?: string
}

/**
 * Connect mode. Creates the credential draft and writes the origin-specific
 * OAuth return context before handing off to the provider via
 * {@link useConnectOAuthService}.
 */
type ConnectOAuthModalConnectProps = ConnectOAuthModalBaseProps & {
  mode: 'connect'
  workspaceId: string
  requiredScopes: readonly string[]
} & (
    | { origin: 'workflow'; workflowId: string }
    | { origin: 'kb-connectors'; knowledgeBaseId: string; connectorType?: string }
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
  const t = useTranslations('auto')
  const { open, onOpenChange, mode } = props
  const isConnect = mode === 'connect'

  const providerId = useMemo(
    () => props.providerId ?? (props.serviceId ? getProviderIdFromServiceId(props.serviceId) : ''),
    [props.providerId, props.serviceId]
  )

  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: session } = useSession()
  const userName = session?.user?.name

  const { providerName, ProviderIcon } = useMemo(() => {
    if (props.serviceName && props.serviceIcon) {
      return { providerName: props.serviceName, ProviderIcon: props.serviceIcon }
    }
    const provider = (props.provider ?? providerId) as OAuthProvider
    return resolveService(provider, props.serviceId ?? providerId)
  }, [props.serviceName, props.serviceIcon, props.provider, props.serviceId, providerId])

  const workspaceId = isConnect ? props.workspaceId : ''
  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: isConnect && Boolean(workspaceId) && open,
  })
  const createDraft = useCreateCredentialDraft()
  const connectOAuthService = useConnectOAuthService()

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

  const requiredScopes = props.requiredScopes ?? EMPTY_SCOPES
  const newScopes = !isConnect ? (props.newScopes ?? EMPTY_SCOPES) : EMPTY_SCOPES

  const newScopesSet = useMemo(
    () => new Set([...newScopes].filter((scope) => !isHiddenScope(scope))),
    [newScopes]
  )

  const displayScopes = useMemo(() => {
    const filtered = [...requiredScopes].filter((scope) => !isHiddenScope(scope))
    if (isConnect) return filtered
    return filtered.sort((a, b) => {
      const aIsNew = newScopesSet.has(a)
      const bIsNew = newScopesSet.has(b)
      if (aIsNew && !bIsNew) return -1
      if (!aIsNew && bIsNew) return 1
      return 0
    })
  }, [isConnect, requiredScopes, newScopesSet])

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
      return
    }
    if (!isConnect || prefilled.current || credentialsLoading) return
    prefilled.current = true
    setDisplayName(defaultDisplayName(userName, providerName, takenNames))
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
    try {
      let connectorType: string | undefined

      if (isConnect) {
        const trimmed = displayName.trim()
        if (!trimmed) {
          setValidationError('Display name is required.')
          return
        }

        await createDraft.mutateAsync({
          workspaceId,
          providerId,
          displayName: trimmed,
          description: description.trim() || undefined,
        })

        const preCount = credentials.filter(
          (c) => c.type === 'oauth' && c.providerId === providerId
        ).length

        const baseContext = {
          displayName: trimmed,
          providerId,
          preCount,
          workspaceId,
          requestedAt: Date.now(),
        }

        let returnContext: OAuthReturnContext
        if (props.origin === 'kb-connectors') {
          connectorType = props.connectorType
          returnContext = {
            ...baseContext,
            origin: 'kb-connectors',
            knowledgeBaseId: props.knowledgeBaseId,
            connectorType: props.connectorType,
          }
        } else if (props.origin === 'workflow') {
          returnContext = { ...baseContext, origin: 'workflow', workflowId: props.workflowId }
        } else {
          returnContext = { ...baseContext, origin: 'integrations' }
        }

        writeOAuthReturnContext(returnContext)
      } else if (props.onConnect) {
        await props.onConnect()
        handleClose()
        return
      } else {
        logger.info('Reauthorizing OAuth2', {
          providerId,
          requiredScopes,
          hasNewScopes: newScopes.length > 0,
        })
      }

      const callbackURL = new URL(window.location.href)
      if (connectorType) {
        callbackURL.searchParams.set(ADD_CONNECTOR_SEARCH_PARAM, connectorType)
      }

      await connectOAuthService.mutateAsync({
        providerId,
        callbackURL: callbackURL.toString(),
      })
      handleClose()
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to start OAuth connection')
      setSubmitError(message)
      logger.error('Failed to connect OAuth service', err)
    }
  }

  const isPending = (isConnect && createDraft.isPending) || connectOAuthService.isPending
  const isDisabled = isConnect
    ? !displayName.trim() || isPending || Boolean(existingCredential)
    : isPending

  /**
   * Submits the connect form on Enter, mirroring the Connect button's enabled
   * state and excluding the multi-line description. Restores the keyboard
   * affordance the pre-consolidation workflow modal provided.
   */
  const handleBodyKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !isConnect || isDisabled) return
    if (event.target instanceof HTMLTextAreaElement) return
    event.preventDefault()
    void handleConnect()
  }

  const displayNameError =
    validationError ??
    (existingCredential
      ? `An integration named "${existingCredential.displayName}" already exists.`
      : undefined)

  const title = `Connect ${providerName}`

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={title}>
      <ChipModalHeader icon={ProviderIcon} onClose={handleClose}>
        {title}
      </ChipModalHeader>
      <ChipModalBody onKeyDown={handleBodyKeyDown}>
        {!isConnect && (
          <p className='text-[var(--text-tertiary)] text-caption'>
            {t('the')}
            {props.toolName}
            {t('tool_requires_access_to_your_account')}
          </p>
        )}

        {isConnect && (
          <ChipModalField
            type='input'
            title={t('display_name')}
            value={displayName}
            onChange={(value) => {
              setDisplayName(value)
              if (validationError) setValidationError(null)
            }}
            placeholder={t('integration_name')}
            autoComplete='off'
            required
            error={displayNameError}
          />
        )}

        {isConnect && (
          <ChipModalField
            type='textarea'
            title={t('description')}
            value={description}
            onChange={setDescription}
            placeholder={t('optional_description')}
            maxLength={500}
            minHeight={80}
          />
        )}

        {displayScopes.length > 0 && (
          <ChipModalField type='custom' title={t('permissions_requested')}>
            <InfoCard>
              <InfoCardList>
                {displayScopes.map((scope) => (
                  <InfoCardItem key={scope}>
                    <span className='flex items-center gap-2'>
                      {getScopeDescription(scope)}
                      {!isConnect && newScopesSet.has(scope) && (
                        <Badge variant='amber' size='sm'>
                          {t('new')}
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
        primaryAction={{
          label: isPending ? 'Connecting...' : 'Connect',
          onClick: handleConnect,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
