'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipCopyInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  SecretInput,
} from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { AWS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
  useWorkloadIdentitySetup,
} from '@/hooks/queries/scoped-credentials'

interface AwsAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceIcon: ComponentType<{ className?: string }>
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onCreated?: (credentialId: string) => void
}

type AwsAuthType = 'oidc_role' | 'access_keys' | 'assume_role'

const ROLE_ARN_PLACEHOLDER = 'arn:aws:iam::123456789012:role/sim-workflows'
const ACCOUNT_ID_FROM_ROLE_ARN = /^arn:aws[\w-]*:iam::(\d{12}):role\//

/** The trust policy a customer attaches to the role so it trusts exactly this credential. */
function buildTrustPolicy(issuer: string, audience: string, subject: string, roleArn: string) {
  const issuerHostPath = issuer.replace(/^https:\/\//, '')
  const match = ACCOUNT_ID_FROM_ROLE_ARN.exec(roleArn.trim())
  const accountId = match?.[1] ?? '<AWS_ACCOUNT_ID>'
  const partition = roleArn.trim().startsWith('arn:aws-') ? roleArn.trim().split(':')[1] : 'aws'
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: `arn:${partition}:iam::${accountId}:oidc-provider/${issuerHostPath}`,
          },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              [`${issuerHostPath}:aud`]: audience,
              [`${issuerHostPath}:sub`]: subject,
            },
          },
        },
      ],
    },
    null,
    2
  )
}

/** Saved AWS identities share the standard credential create/reconnect lifecycle. */
export function AwsAccountModal(props: AwsAccountModalProps) {
  if (!props.open) return null
  return (
    <AwsAccountForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function AwsAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: AwsAccountModalProps) {
  // Keyless roles bind their subject to a workspace; organization credentials use keys.
  const supportsOidc = Boolean(workspaceId) && !organizationId
  const [authType, setAuthType] = useState<AwsAuthType>(supportsOidc ? 'oidc_role' : 'access_keys')
  const [roleArn, setRoleArn] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [externalId, setExternalId] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sessionKey] = useState(() => generateShortId())

  const setup = useWorkloadIdentitySetup({
    workspaceId,
    provider: 'aws',
    sessionKey,
    enabled: authType === 'oidc_role',
  })
  const trust = setup.data
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()
  const isPending = createCredential.isPending || updateCredential.isPending
  const action = credentialId ? 'Reconnect' : 'Add'

  const needsKeys = authType === 'access_keys' || authType === 'assume_role'
  const needsRole = authType === 'oidc_role' || authType === 'assume_role'
  const disabled =
    isPending ||
    (needsKeys && (!accessKeyId.trim() || !secretAccessKey)) ||
    (needsRole && !roleArn.trim()) ||
    (authType === 'oidc_role' && !trust)

  const clearError = () => setError(null)

  const buildConfig = () => {
    if (authType === 'oidc_role' && trust) {
      return {
        authType,
        roleArn: roleArn.trim(),
        subject: trust.subject,
        subjectProof: trust.subjectProof,
      }
    }
    const keys = { accessKeyId: accessKeyId.trim(), secretAccessKey }
    if (authType === 'assume_role') {
      return {
        authType,
        ...keys,
        roleArn: roleArn.trim(),
        ...(externalId.trim() ? { externalId: externalId.trim() } : {}),
      }
    }
    return { authType: 'access_keys' as const, ...keys }
  }

  const submit = async () => {
    if (disabled) return
    setError(null)
    const input = {
      ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
      serviceAccountJson: JSON.stringify(buildConfig()),
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
    }
    try {
      let connectedId = credentialId
      if (credentialId)
        await updateCredential.mutateAsync({
          ...input,
          credentialId,
          description: description.trim() || null,
        })
      else {
        const created = await createCredential.mutateAsync({
          ...input,
          type: 'service_account',
          providerId: AWS_SERVICE_ACCOUNT_PROVIDER_ID,
        })
        connectedId = created.credential.id
      }
      if (connectedId) onCreated?.(connectedId)
      onOpenChange(false)
    } catch (error) {
      if (isApiClientError(error) && error.code === 'duplicate_display_name') {
        setError('A credential with that name already exists. Choose a different display name.')
        return
      }
      setError(
        isApiClientError(error) && error.message
          ? error.message
          : 'Could not verify the AWS credential. Check the details and try again.'
      )
    }
  }

  const authOptions = [
    ...(supportsOidc ? [{ value: 'oidc_role', label: 'IAM role (keyless, via Sim OIDC)' }] : []),
    { value: 'access_keys', label: 'Access keys' },
    { value: 'assume_role', label: 'Access keys that assume an IAM role' },
  ]

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={`${action} AWS credential`}>
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {action} AWS credential
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Authentication'
          value={authType}
          onChange={(value) => {
            setAuthType(value as AwsAuthType)
            clearError()
          }}
          options={authOptions}
          placeholder='Choose how Sim signs in to AWS'
          required
          hint={
            authType === 'oidc_role'
              ? 'No keys are stored. Sim signs a short-lived token that your role trusts.'
              : authType === 'assume_role'
                ? 'Sim uses the keys only to assume the role, then works with temporary credentials.'
                : 'Sim signs requests with these long-lived keys.'
          }
        />

        {authType === 'oidc_role' && (
          <>
            {setup.isError && (
              <ChipModalError>
                {isApiClientError(setup.error) && setup.error.message
                  ? setup.error.message
                  : 'Could not start a keyless role connection. Use access keys instead.'}
              </ChipModalError>
            )}
            {trust && (
              <>
                <ChipModalField
                  type='custom'
                  title='Identity provider URL'
                  hint='In IAM, add an OpenID Connect identity provider with this URL (once per AWS account).'
                >
                  {(aria) => <ChipCopyInput {...aria} value={trust.issuer} copyLabel='Copy URL' />}
                </ChipModalField>
                <ChipModalField type='custom' title='Audience'>
                  {(aria) => (
                    <ChipCopyInput {...aria} value={trust.audience} copyLabel='Copy audience' />
                  )}
                </ChipModalField>
                <ChipModalField
                  type='custom'
                  title='Subject'
                  hint='Unique to this credential. Your role trusts only this subject.'
                >
                  {(aria) => (
                    <ChipCopyInput {...aria} value={trust.subject} copyLabel='Copy subject' />
                  )}
                </ChipModalField>
              </>
            )}
          </>
        )}

        {needsKeys && (
          <>
            <ChipModalField
              type='input'
              title='Access key ID'
              value={accessKeyId}
              onChange={(value) => {
                setAccessKeyId(value)
                clearError()
              }}
              placeholder='AKIA...'
              required
              autoComplete='off'
            />
            <ChipModalField type='custom' title='Secret access key' required>
              {(aria) => (
                <SecretInput
                  {...aria}
                  value={secretAccessKey}
                  onChange={(value) => {
                    setSecretAccessKey(value)
                    clearError()
                  }}
                  placeholder='Enter the secret access key'
                  autoComplete='new-password'
                  data-lpignore='true'
                />
              )}
            </ChipModalField>
          </>
        )}

        {needsRole && (
          <ChipModalField
            type='input'
            title='Role ARN'
            value={roleArn}
            onChange={(value) => {
              setRoleArn(value)
              clearError()
            }}
            placeholder={ROLE_ARN_PLACEHOLDER}
            required
            autoComplete='off'
          />
        )}

        {authType === 'assume_role' && (
          <ChipModalField
            type='input'
            title='External ID'
            value={externalId}
            onChange={(value) => {
              setExternalId(value)
              clearError()
            }}
            placeholder='Optional, if the role requires one'
            autoComplete='off'
          />
        )}

        {authType === 'oidc_role' && trust && (
          <ChipModalField
            type='custom'
            title='Role trust policy'
            hint='Set this as the role’s trust policy, then add the permissions your workflows need.'
          >
            {(aria) => (
              <ChipTextarea
                {...aria}
                readOnly
                value={buildTrustPolicy(trust.issuer, trust.audience, trust.subject, roleArn)}
                className='min-h-[220px] font-mono text-xs'
                spellCheck={false}
              />
            )}
          </ChipModalField>
        )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the AWS identity ARN'
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
            onClick: () =>
              window.open(
                'https://docs.sim.ai/integrations/aws-credentials',
                '_blank',
                'noopener,noreferrer'
              ),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Verifying...' : `${action} credential`,
          onClick: submit,
          disabled,
        }}
      />
    </ChipModal>
  )
}
