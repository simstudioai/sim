'use client'

import { TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { AtlassianServiceAccountModal } from '@/app/(product)/_components/service-account-modal/atlassian-service-account-modal'
import {
  GoogleServiceAccountModal,
  ServiceAccountFormFields,
} from '@/app/(product)/_components/service-account-modal/google-service-account-modal'
import { OciApiKeyModal } from '@/app/(product)/_components/service-account-modal/oci-api-key-modal'
import { OracleDatabaseAccountModal } from '@/app/(product)/_components/service-account-modal/oracle-database-account-modal'
import { SlackBotModal } from '@/app/(product)/_components/service-account-modal/slack-bot-modal'
import {
  type ResourceScope,
  serviceAccountSetupKind,
  useServiceAccountForm,
} from '@/platform/lib/data/credentials'

interface SetupModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ResourceScope
  /** The vendor the setup is titled with, such as "Atlassian" for a family key. */
  serviceName: string
  /** Receives the new credential, so the picker can select it. */
  onCreated: (credentialId: string) => void
}

/** Saves a pasted token or client credentials through another operation; see `useServiceAccountForm`. */
interface KeyFormSubmitProps {
  submitCredentials?: (fields: Record<string, string>) => Promise<string>
  submitPending?: boolean
  /**
   * An account the dialog replaces, titled Reconnect and keeping its name. With `credentialId`, a
   * cloud configuration (AWS, Databricks, Snowflake, a Microsoft app) is saved onto that credential
   * in place; otherwise
   * `submitCredentials` replaces it.
   */
  replacedAccount?: { credentialId?: string; displayName?: string; description?: string }
}

interface ServiceAccountModalProps extends SetupModalProps, KeyFormSubmitProps {
  serviceAccountProviderId: string
  /** The Atlassian product the account is for, which picks its setup guide. */
  atlassianProduct?: 'jira' | 'confluence'
  /** Overrides the Atlassian setup guide, such as a search connector's own page. */
  atlassianSetupGuideUrl?: string
  /** The OAuth service the account is for; a Google Cloud service also offers keyless setup. */
  oauthServiceId?: string
}

/**
 * Adds a service account in place, from a workflow block's credential picker, a knowledge connector
 * or an organization's Search source, owned by the workspace or organization `scope` names, with the
 * dialog its provider needs: a pasted token, an app's client credentials, a cloud configuration
 * (AWS, Databricks, Snowflake, a Microsoft app, keyless sign-in included), a Google JSON key or
 * keyless Google Cloud setup, an Atlassian API token, an OCI
 * signing key, an Oracle Database wallet or a custom Slack bot. The provider verifies the secret
 * before it is stored, and `onCreated` receives the new credential to select. `submitCredentials`
 * saves a pasted token or client credentials through another operation, as a member's saved Search
 * account does.
 */
export function ServiceAccountModal({
  serviceAccountProviderId,
  atlassianProduct,
  atlassianSetupGuideUrl,
  oauthServiceId,
  open,
  onOpenChange,
  scope,
  serviceName,
  onCreated,
  submitCredentials,
  submitPending,
  replacedAccount,
}: ServiceAccountModalProps) {
  switch (serviceAccountSetupKind(serviceAccountProviderId)) {
    case 'form':
      return (
        <KeyFormModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceAccountProviderId={serviceAccountProviderId}
          serviceName={serviceName}
          onCreated={onCreated}
          submitCredentials={submitCredentials}
          submitPending={submitPending}
          replacedAccount={replacedAccount}
        />
      )
    case 'google':
      return (
        <GoogleServiceAccountModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
          oauthServiceId={oauthServiceId}
        />
      )
    case 'atlassian':
      return (
        <AtlassianServiceAccountModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
          atlassianProduct={atlassianProduct}
          setupGuideUrl={atlassianSetupGuideUrl}
        />
      )
    case 'oci-api-key':
      return (
        <OciApiKeyModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    case 'oracle-database':
      return (
        <OracleDatabaseAccountModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    case 'slack-bot':
      return (
        <SlackBotModal
          open={open}
          onOpenChange={onOpenChange}
          scope={scope}
          serviceName={serviceName}
          onCreated={onCreated}
        />
      )
    default:
      return null
  }
}

/** A pasted token, or an app's client credentials with the grant it uses. */
function KeyFormModal({
  open,
  onOpenChange,
  scope,
  serviceAccountProviderId,
  serviceName,
  onCreated,
  submitCredentials,
  submitPending,
  replacedAccount,
}: SetupModalProps & KeyFormSubmitProps & { serviceAccountProviderId: string }) {
  const form = useServiceAccountForm({
    scope,
    serviceAccountProviderId,
    onCreated,
    submitCredentials,
    submitPending,
    initialDisplayName: replacedAccount?.displayName,
    initialDescription: replacedAccount?.description,
    reconnectCredentialId: replacedAccount?.credentialId,
  })
  const docsUrl = form.docsUrl
  const verb = replacedAccount ? 'Reconnect' : 'Add'
  const pendingLabel = replacedAccount ? 'Reconnecting…' : 'Adding…'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${verb} ${form.vendorName ?? serviceName} ${form.connectNoun}`}
      confirmLabel={form.isPending ? pendingLabel : `${verb} ${form.connectNoun}`}
      confirmDisabled={form.confirmDisabled}
      pending={form.isPending}
      onConfirm={() => form.submit()}
      footerStartAction={
        docsUrl
          ? {
              label: 'Setup guide',
              variant: 'quiet',
              onClick: () => window.open(docsUrl, '_blank', 'noopener,noreferrer'),
            }
          : undefined
      }
    >
      <ServiceAccountFormFields fields={form.fields} onChange={form.setField} />
      <TextField
        label='Display name'
        value={form.displayName}
        onChange={form.setDisplayName}
        placeholder={`${form.vendorName ?? serviceName} ${form.connectNoun}`}
        autoComplete='off'
        optional
      />
      <TextAreaField
        label='Description'
        value={form.description}
        onChange={form.setDescription}
        placeholder='What will you use this connection for?'
        maxLength={500}
        optional
      />
    </Modal>
  )
}
