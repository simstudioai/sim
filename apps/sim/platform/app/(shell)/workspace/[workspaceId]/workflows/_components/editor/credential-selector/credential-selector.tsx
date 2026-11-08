'use client'

import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { InlineNotice } from '@sim/emcn/status'
import { OAuthConnectModal } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/oauth-connect-modal/oauth-connect-modal'
import { ServiceAccountModal } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/service-account-modal/service-account-modal'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/credential-selector/credential-selector.module.css'
import { isWorkflowSearchTargetForField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import {
  type SubBlockConfig,
  useDependsOnGate,
  useSubBlockValue,
  useWorkflowRegistry,
  useWorkflowScope,
} from '@/platform/lib/data/workflow-editor'
import {
  consumeOAuthReturnContext,
  getCanonicalScopesForProvider,
  getMissingRequiredScopes,
  getOAuthProviderIcon,
  getOAuthProviderName,
  getProviderIdFromServiceId,
  type OAuthProvider,
  resolveMicrosoftDataverseCredentialPolicy,
  useCredentialRefreshTriggers,
  useOAuthCredentials,
  useServiceAccountTarget,
  useWorkspaceCredential,
  useWorkspaceCredentials,
  writeOAuthReturnContext,
} from '@/platform/lib/data/workflow-editor/selectors'

const NO_OAUTH_CREDENTIALS: never[] = []
const NO_WORKSPACE_CREDENTIALS: never[] = []

/** The picker row that sets up a service account when two connect actions share the list. */
const ADD_SERVICE_ACCOUNT = '__connect_service_account__'

function ProviderMark({ provider }: { provider: string }) {
  const ProviderIcon: ComponentType<{ className?: string }> | null = getOAuthProviderIcon(provider)
  if (!ProviderIcon) return <Icon name='I030' />
  return (
    <span className={styles.mark} aria-hidden='true'>
      <ProviderIcon />
    </span>
  )
}

interface CredentialSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: unknown
  /** Sibling values in preview or inside a tool, in place of the block's stored values. */
  previewContextValues?: Record<string, unknown>
}

/**
 * Picks the credential a block runs with: the connected accounts of its OAuth provider, its service
 * accounts, both, or (without a service) any workspace OAuth credential. It connects another account
 * through the provider, explains a credential the viewer cannot access by its name, and warns when
 * the selected account lacks a scope the block needs, with a reauthorize that adds it.
 */
export function CredentialSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: CredentialSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const { workspaceId } = useWorkflowScope()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlock.id)
  const [connectOpen, setConnectOpen] = useState(false)
  const [reauthorizeOpen, setReauthorizeOpen] = useState(false)
  const [serviceAccountOpen, setServiceAccountOpen] = useState(false)

  const serviceId = subBlock.serviceId || ''
  const isAllCredentials = !serviceId
  const provider = getProviderIdFromServiceId(serviceId) as OAuthProvider

  const { depsSatisfied, dependsOn, dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })
  const hasDependencies = dependsOn.length > 0
  const effectiveDisabled = disabled || (hasDependencies && !depsSatisfied)

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedId = typeof effectiveValue === 'string' ? effectiveValue : ''
  const isTriggerMode = subBlock.mode === 'trigger' || subBlock.mode === 'trigger-advanced'

  const oauthCredentials = useOAuthCredentials(provider, {
    enabled: !isAllCredentials && Boolean(provider),
    workspaceId,
    workflowId: activeWorkflowId || undefined,
  })
  const workspaceCredentials = useWorkspaceCredentials({ workspaceId, enabled: isAllCredentials })
  const rawCredentials = oauthCredentials.data ?? NO_OAUTH_CREDENTIALS
  const allWorkspaceCredentials = workspaceCredentials.data ?? NO_WORKSPACE_CREDENTIALS
  const credentialsLoading = isAllCredentials
    ? workspaceCredentials.isFetching
    : oauthCredentials.isFetching

  const credentialKind = subBlock.credentialKind
  const isMergedKinds = credentialKind === 'any'

  // A service-account picker lists only service accounts, a merged picker both kinds, and a trigger
  // leaves service accounts out unless the block allows them.
  const credentials = useMemo(() => {
    if (credentialKind === 'service-account')
      return rawCredentials.filter((credential) => credential.type === 'service_account')
    if (isMergedKinds) return rawCredentials
    return isTriggerMode && !subBlock.allowServiceAccounts
      ? rawCredentials.filter((credential) => credential.type !== 'service_account')
      : rawCredentials
  }, [rawCredentials, isTriggerMode, credentialKind, isMergedKinds, subBlock.allowServiceAccounts])

  const serviceAccountTarget = useServiceAccountTarget(
    serviceId,
    credentialKind === 'service-account' || isMergedKinds
  )
  const serviceAccountConnectHidden = Boolean(serviceAccountTarget?.hidden)

  const selectedCredential = credentials.find((credential) => credential.id === selectedId)
  const oauthWorkspaceCredentials = useMemo(
    () => allWorkspaceCredentials.filter((credential) => credential.type === 'oauth'),
    [allWorkspaceCredentials]
  )
  const selectedAllCredential = isAllCredentials
    ? (allWorkspaceCredentials.find((credential) => credential.id === selectedId) ?? null)
    : null
  const isServiceAccount =
    selectedCredential?.type === 'service_account' ||
    selectedAllCredential?.type === 'service_account'

  const { data: inaccessibleCredential } = useWorkspaceCredential(
    selectedId || undefined,
    Boolean(selectedId) &&
      !selectedCredential &&
      !selectedAllCredential &&
      !credentialsLoading &&
      Boolean(workspaceId)
  )
  const resolvedLabel = selectedAllCredential
    ? selectedAllCredential.displayName
    : selectedCredential
      ? selectedCredential.name
      : (inaccessibleCredential?.displayName ?? '')

  const dataversePolicy = resolveMicrosoftDataverseCredentialPolicy({
    dependsOn,
    environmentUrl: dependencyValues.environmentUrl,
    hasSelectedCredential: Boolean(selectedCredential),
    providerId: provider,
    selectedCredentialScopes: selectedCredential?.scopes,
  })
  const requiredScopes = dataversePolicy.applies
    ? dataversePolicy.requiredScopes
    : (subBlock.requiredScopes ?? [])

  const { refetch: refetchOAuth } = oauthCredentials
  const { refetch: refetchWorkspace } = workspaceCredentials
  const refetch = useCallback(
    () => (isAllCredentials ? refetchWorkspace() : refetchOAuth()),
    [isAllCredentials, refetchWorkspace, refetchOAuth]
  )
  useCredentialRefreshTriggers(refetch, provider, workspaceId)

  const missingRequiredScopes = selectedCredential
    ? getMissingRequiredScopes(selectedCredential, requiredScopes)
    : []
  const needsUpdate =
    !isServiceAccount &&
    (dataversePolicy.hasInvalidEnvironment ||
      (Boolean(selectedCredential) &&
        (missingRequiredScopes.length > 0 || dataversePolicy.requiresSeparateCredential))) &&
    !effectiveDisabled &&
    !isPreview &&
    !credentialsLoading

  useEffect(() => {
    if (reauthorizeOpen && selectedId && !selectedCredential && !credentialsLoading) {
      consumeOAuthReturnContext()
      setReauthorizeOpen(false)
    }
  }, [reauthorizeOpen, selectedId, selectedCredential, credentialsLoading])

  const providerName = getOAuthProviderName(provider)
  const labels = subBlock.credentialLabels

  const setUpServiceAccount = () => {
    if (serviceAccountTarget) setServiceAccountOpen(true)
  }

  const serviceAccountLabel =
    labels?.serviceAccountConnect ?? serviceAccountTarget?.label ?? `Add ${providerName} key`
  const createAction: { label: string; run: () => void } | null = isAllCredentials
    ? null
    : credentialKind === 'service-account'
      ? serviceAccountConnectHidden || !serviceAccountTarget
        ? null
        : { label: serviceAccountLabel, run: setUpServiceAccount }
      : {
          label: isMergedKinds
            ? (labels?.oauthConnect ?? `Connect ${providerName} account`)
            : credentials.length > 0
              ? `Connect another ${providerName} account`
              : `Connect ${providerName} account`,
          run: () => setConnectOpen(true),
        }

  const options = useMemo(() => {
    if (isAllCredentials)
      return oauthWorkspaceCredentials.map((credential) => ({
        value: credential.id,
        label: credential.displayName,
        leading: <Icon name='I137' />,
      }))
    // A merged picker lists the OAuth accounts before the service accounts, as its groups did.
    const ordered = isMergedKinds
      ? [
          ...credentials.filter((credential) => credential.type !== 'service_account'),
          ...credentials.filter((credential) => credential.type === 'service_account'),
        ]
      : credentials
    const rows: { value: string; label: string; leading: ReactNode }[] = ordered.map(
      (credential) => ({
        value: credential.id,
        label: credential.name,
        leading:
          isMergedKinds && credential.type === 'service_account' ? (
            <Icon name='I137' />
          ) : (
            <ProviderMark provider={credential.provider ?? provider} />
          ),
      })
    )
    if (isMergedKinds && !serviceAccountConnectHidden && serviceAccountTarget)
      rows.push({
        value: ADD_SERVICE_ACCOUNT,
        label: serviceAccountLabel,
        leading: <Icon name='I074' />,
      })
    return rows
  }, [
    isAllCredentials,
    oauthWorkspaceCredentials,
    credentials,
    isMergedKinds,
    provider,
    serviceAccountConnectHidden,
    serviceAccountTarget,
    serviceAccountLabel,
  ])

  const selectedLeading: ReactNode = !resolvedLabel ? undefined : isAllCredentials &&
    selectedAllCredential ? (
    <Icon name='I137' />
  ) : (
    <ProviderMark provider={selectedCredential?.provider ?? provider} />
  )

  const handleChange = (next: string | null) => {
    if (next === ADD_SERVICE_ACCOUNT) {
      setUpServiceAccount()
      return
    }
    if (!next || isPreview) return
    setStoreValue(next)
  }

  const searchMatch = isWorkflowSearchTargetForField({
    activeSearchTarget,
    subBlockId: subBlock.id,
  })
  const label = subBlock.title || subBlock.placeholder || 'Credential'

  return (
    <div className={styles.selector}>
      <div className={styles.picker} data-search-match={searchMatch || undefined}>
        <SearchableSelect
          label={label}
          labelHidden
          options={options}
          // A stored id that resolves to no name (still loading, or gone) shows the placeholder.
          value={selectedId && resolvedLabel ? selectedId : null}
          selectedLabel={resolvedLabel || undefined}
          selectedLeading={selectedLeading}
          onValueChange={handleChange}
          onOpenChange={(open) => {
            if (open) void refetch()
          }}
          placeholder={
            hasDependencies && !depsSatisfied
              ? 'Fill in required fields above first'
              : subBlock.placeholder || 'Select credential'
          }
          searchLabel='Search credentials...'
          disabled={effectiveDisabled || isPreview}
          createLabel={createAction?.label}
          onCreate={createAction?.run}
        />
      </div>

      {needsUpdate && (
        <InlineNotice
          intent='warning'
          message={dataversePolicy.message}
          action={
            dataversePolicy.hasInvalidEnvironment ? undefined : (
              <Button
                variant='secondary'
                size='compact'
                onClick={() => {
                  if (dataversePolicy.requiresSeparateCredential) {
                    setConnectOpen(true)
                    return
                  }
                  writeOAuthReturnContext({
                    origin: 'workflow',
                    workflowId: activeWorkflowId || '',
                    displayName: selectedCredential?.name ?? providerName,
                    providerId: provider,
                    preCount: credentials.filter(
                      (credential) => credential.type !== 'service_account'
                    ).length,
                    workspaceId,
                    reconnect: true,
                    requestedAt: Date.now(),
                  })
                  setReauthorizeOpen(true)
                }}
              >
                {dataversePolicy.actionLabel}
              </Button>
            )
          }
        />
      )}

      {serviceAccountOpen && serviceAccountTarget && (
        <ServiceAccountModal
          open={serviceAccountOpen}
          onOpenChange={setServiceAccountOpen}
          workspaceId={workspaceId}
          serviceAccountProviderId={serviceAccountTarget.serviceAccountProviderId}
          atlassianProduct={serviceAccountTarget.atlassianProduct}
          serviceName={serviceAccountTarget.serviceName}
          onCreated={(credentialId) => {
            setStoreValue(credentialId)
            void refetchOAuth()
          }}
        />
      )}

      {connectOpen && (
        <OAuthConnectModal
          open={connectOpen}
          onOpenChange={setConnectOpen}
          mode='connect'
          provider={provider}
          serviceId={serviceId}
          providerId={provider}
          requiredScopes={
            dataversePolicy.applies ? requiredScopes : getCanonicalScopesForProvider(provider)
          }
          workspaceId={workspaceId}
          returnTo={{ origin: 'workflow', workflowId: activeWorkflowId || '' }}
          requireDataverseEnvironment={dataversePolicy.applies}
          dataverseEnvironmentUrl={dataversePolicy.environmentUrl}
        />
      )}

      {reauthorizeOpen && selectedCredential && (
        <OAuthConnectModal
          open={reauthorizeOpen}
          onOpenChange={setReauthorizeOpen}
          onDismiss={consumeOAuthReturnContext}
          mode='reauthorize'
          provider={provider}
          serviceId={serviceId}
          // A reauthorize returns to the authorization server that issued the credential.
          providerId={selectedCredential.provider}
          toolName={providerName}
          requiredScopes={
            dataversePolicy.applies ? requiredScopes : getCanonicalScopesForProvider(provider)
          }
          newScopes={missingRequiredScopes}
          workspaceId={workspaceId}
          reconnectTarget={{
            credentialId: selectedCredential.id,
            displayName: selectedCredential.name,
          }}
          requireDataverseEnvironment={dataversePolicy.applies}
          dataverseEnvironmentUrl={dataversePolicy.environmentUrl}
        />
      )}
    </div>
  )
}
