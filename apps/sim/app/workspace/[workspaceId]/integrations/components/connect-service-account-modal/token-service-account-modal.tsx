'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  SecretInput,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import type { ServiceAccountSecretFields } from '@/lib/credentials/service-account-secret'
import {
  CLIENT_CREDENTIALS_AUTH_METHOD,
  getTokenServiceAccountErrorMessage,
  isTokenServiceAccountFieldRequired,
  type TokenServiceAccountAuthMethod,
  type TokenServiceAccountDescriptor,
  type TokenServiceAccountField,
  tokenFieldBelongsToAuthMethod,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { ClientCredentialsFields } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/client-credentials-fields'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'

const logger = createLogger('TokenServiceAccountModal')

function normalizeDomainInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
}

function openDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

interface TokenServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  descriptor: TokenServiceAccountDescriptor
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /** When set, reconnect (rotate the secret on) this credential in place. */
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  /** Called with the credential id after a successful create or reconnect. */
  onCreated?: (credentialId: string) => void
  onSubmitCredentials?: (
    fields: ServiceAccountSecretFields & { displayName?: string; description?: string }
  ) => Promise<string>
  submitPending?: boolean
}

/**
 * Generic connect modal for token-paste service accounts. Renders the fields
 * declared by the provider's {@link TokenServiceAccountDescriptor} (a secret
 * token, plus a domain for providers that need one) and submits through the
 * same create/update credential mutations as the other service-account modals.
 * Server-side verification failures are mapped from the route's `error.code`.
 */
export function TokenServiceAccountModal(props: TokenServiceAccountModalProps) {
  if (!props.open) return null
  return (
    <TokenServiceAccountModalForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.descriptor.providerId}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function TokenServiceAccountModalForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  descriptor,
  serviceName,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
  onSubmitCredentials,
  submitPending,
}: TokenServiceAccountModalProps) {
  const clientCredentials = descriptor.clientCredentials
  const [selectedAuthMethod, setSelectedAuthMethod] =
    useState<TokenServiceAccountAuthMethod | null>(null)
  /**
   * A reconnect cannot pre-select the mode: the stored one lives inside the encrypted secret and
   * is never returned to the client, so the admin restates it while retyping the secret. Until
   * then neither mode's fields show, so a reconnect never switches modes by default.
   */
  const mustRestateAuthMethod = Boolean(clientCredentials && credentialId && !selectedAuthMethod)
  const authMethod: TokenServiceAccountAuthMethod | null =
    selectedAuthMethod ??
    (mustRestateAuthMethod
      ? null
      : clientCredentials?.preferred
        ? CLIENT_CREDENTIALS_AUTH_METHOD
        : 'token')
  const usesClientCredentials = authMethod === CLIENT_CREDENTIALS_AUTH_METHOD
  /** A field that belongs to one sign-in mode (ServiceNow's username) shows once that mode is chosen. */
  const shownField = (id: TokenServiceAccountField['id']) =>
    descriptor.fields.find(
      (field) =>
        field.id === id &&
        (authMethod
          ? tokenFieldBelongsToAuthMethod(field, authMethod)
          : !field.requiredForAuthMethods)
    )
  const tokenField = descriptor.fields.find((field) => field.id === 'apiToken')
  const domainField = shownField('domain')
  const workspaceField = shownField('providerWorkspaceId')
  /**
   * A new connection starts on the domain's default (the region or host it had before the field
   * existed). A reconnect starts blank, which keeps the stored value: the server carries it
   * forward, since the stored one is never returned to the client.
   */
  const initialDomain = credentialId ? '' : (domainField?.defaultValue ?? '')

  const [apiToken, setApiToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [domain, setDomain] = useState(initialDomain)
  const [providerWorkspaceId, setProviderWorkspaceId] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  const trimmedToken = apiToken.trim()
  const normalizedDomain = domainField?.url ? domain.trim() : normalizeDomainInput(domain)
  const trimmedWorkspaceId = providerWorkspaceId.trim()
  const isPending =
    createCredential.isPending || updateCredential.isPending || submitPending === true
  const isFieldRequired = (field: TokenServiceAccountField): boolean =>
    isTokenServiceAccountFieldRequired(field) ||
    (field.requiredForDomain !== undefined &&
      normalizedDomain.toLowerCase() === field.requiredForDomain)
  const isDisabled =
    !authMethod ||
    (usesClientCredentials ? !clientId.trim() || !clientSecret.trim() : !trimmedToken) ||
    Boolean(domainField && isFieldRequired(domainField) && !normalizedDomain) ||
    Boolean(workspaceField && isFieldRequired(workspaceField) && !trimmedWorkspaceId) ||
    isPending

  const hintFor = (field: TokenServiceAccountField, value: string): string | undefined => {
    if (!field.hintPattern || !field.hintMessage || value.length === 0) return undefined
    return field.hintPattern.test(value) ? undefined : field.hintMessage
  }

  const renderConnectionField = (
    field: TokenServiceAccountField,
    value: string,
    setValue: (value: string) => void,
    formatError?: string
  ) => {
    const onChange = (next: string) => {
      setValue(next)
      if (error) setError(null)
    }
    const placeholder =
      credentialId && field.defaultValue !== undefined
        ? `Keep the current ${field.label.toLowerCase()}`
        : field.placeholder
    if (field.options) {
      return (
        <ChipModalField
          type='dropdown'
          title={field.label}
          value={value || undefined}
          onChange={onChange}
          options={field.options}
          placeholder={placeholder}
          align='start'
          required={isFieldRequired(field)}
        />
      )
    }
    return (
      <ChipModalField
        type='input'
        title={field.label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete='off'
        required={isFieldRequired(field)}
        error={formatError}
      />
    )
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    try {
      const secretFields = {
        ...(usesClientCredentials
          ? {
              authMethod: CLIENT_CREDENTIALS_AUTH_METHOD,
              clientId: clientId.trim(),
              clientSecret: clientSecret.trim(),
            }
          : { apiToken: tokenField?.preserveWhitespace ? apiToken : trimmedToken }),
        ...(workspaceField && trimmedWorkspaceId
          ? { providerWorkspaceId: trimmedWorkspaceId }
          : {}),
        ...(domainField && normalizedDomain ? { domain: normalizedDomain } : {}),
      }
      if (onSubmitCredentials) {
        const savedId = await onSubmitCredentials({
          ...secretFields,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        onCreated?.(savedId)
        onOpenChange(false)
        return
      }
      if (credentialId) {
        await updateCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          credentialId,
          ...secretFields,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        onCreated?.(credentialId)
      } else {
        const created = await createCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          type: 'service_account',
          providerId: descriptor.providerId,
          ...secretFields,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        onCreated?.(created.credential.id)
      }
      onOpenChange(false)
    } catch (err: unknown) {
      const code = isApiClientError(err) ? err.code : undefined
      setError(
        getTokenServiceAccountErrorMessage(
          descriptor,
          code,
          onSubmitCredentials ? getErrorMessage(err, 'Could not save this connection.') : undefined,
          authMethod ?? undefined
        )
      )
      logger.error(`Failed to add ${descriptor.serviceLabel} service account credential`, err)
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Add ${serviceName} ${descriptor.connectNoun}`}
    >
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        Add {serviceName} {descriptor.connectNoun}
      </ChipModalHeader>
      <ChipModalBody>
        {clientCredentials && (
          <ChipModalField
            type='dropdown'
            title='Authentication'
            value={authMethod ?? undefined}
            onChange={(value) => {
              setSelectedAuthMethod(value as TokenServiceAccountAuthMethod)
              if (error) setError(null)
            }}
            options={[
              { value: CLIENT_CREDENTIALS_AUTH_METHOD, label: clientCredentials.label },
              { value: 'token', label: clientCredentials.tokenLabel },
            ]}
            required
          />
        )}

        {clientCredentials && usesClientCredentials && (
          <ClientCredentialsFields
            clientId={clientId}
            clientSecret={clientSecret}
            onClientIdChange={(value) => {
              setClientId(value)
              if (error) setError(null)
            }}
            onClientSecretChange={(value) => {
              setClientSecret(value)
              if (error) setError(null)
            }}
            clientIdHint={clientCredentials.helpText}
            secretInputName={`${descriptor.providerId}_client_secret`}
          />
        )}

        {tokenField && authMethod === 'token' && (
          <ChipModalField
            type='custom'
            title={tokenField.label}
            required
            hint={hintFor(tokenField, trimmedToken) ?? descriptor.helpText}
          >
            {tokenField.multiline ? (
              (aria) => (
                <ChipTextarea
                  {...aria}
                  value={apiToken}
                  onChange={(event) => {
                    setApiToken(event.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={tokenField.placeholder}
                  className='min-h-[120px] font-mono'
                  // Spell-check and autofill would ship a pasted private key to third parties.
                  spellCheck={false}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              )
            ) : (
              <SecretInput
                value={apiToken}
                onChange={(value) => {
                  setApiToken(value)
                  if (error) setError(null)
                }}
                placeholder={tokenField.placeholder}
                name={`${descriptor.providerId}_api_token`}
                autoComplete='new-password'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
            )}
          </ChipModalField>
        )}

        {workspaceField &&
          renderConnectionField(workspaceField, providerWorkspaceId, setProviderWorkspaceId)}
        {domainField &&
          renderConnectionField(
            domainField,
            domain,
            setDomain,
            hintFor(domainField, normalizedDomain)
          )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder={`Defaults to the ${descriptor.serviceLabel} account name`}
          autoComplete='off'
        />

        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Optional description'
          maxLength={500}
          minHeight={80}
        />

        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        secondaryActions={[
          {
            label: 'Setup guide',
            onClick: () => openDocs(descriptor.docsUrl),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Adding...' : `Add ${descriptor.connectNoun}`,
          onClick: handleSubmit,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
