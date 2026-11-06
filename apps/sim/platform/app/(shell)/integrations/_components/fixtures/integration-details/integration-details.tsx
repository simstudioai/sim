'use client'

import { useState, useTransition } from 'react'
import { generateId } from '@sim/utils/id'
import Link from 'next/link'
import { useQueryStates } from 'nuqs'
import { CredentialConnect } from '@/platform/app/(shell)/integrations/_components/credential-connect/credential-connect'
import type { CredentialDraft } from '@/platform/app/(shell)/integrations/_components/credential-connect/types'
import { CredentialDetail } from '@/platform/app/(shell)/integrations/_components/credential-detail/credential-detail'
import { CredentialList } from '@/platform/app/(shell)/integrations/_components/credential-list/credential-list'
import { credentialParams } from '@/platform/app/(shell)/integrations/_components/fixtures/integration-details/search-params'
import { IntegrationCapabilities } from '@/platform/app/(shell)/integrations/_components/integration-capabilities/integration-capabilities'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
import { IntegrationIdea } from '@/platform/app/(shell)/integrations/_components/integration-idea/integration-idea'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import { ProviderHeading } from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading'
import { ActionMenu, Button, Modal } from '@/platform/design-system/components'
import type { IntegrationCatalogEntry } from '@/platform/lib/integrations/catalog-model'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type {
  CredentialConnection,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'
import type { OrganizationIntegration } from '@/platform/lib/integrations/fixture-model'

interface IntegrationDetailsProps {
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
  knownCredentials: readonly IntegrationCredential[]
  organization: { id: string; name: string }
  viewer: IntegrationPerson
  eligiblePeople: readonly IntegrationPerson[]
  workspaces: readonly { id: string; name: string; memberIds: readonly string[] }[]
  people?: readonly IntegrationPerson[]
  peopleTotal?: number
  catalog?: IntegrationCatalogEntry | null
  addedSkills?: readonly string[]
  onAddSkill?: (skill: IntegrationCatalogEntry['skills'][number]) => void
}

export function IntegrationDetails({
  integration,
  onChange,
  knownCredentials,
  organization,
  viewer,
  eligiblePeople,
  workspaces,
  people,
  peopleTotal,
  catalog,
  addedSkills,
  onAddSkill,
}: IntegrationDetailsProps) {
  const [view, setView] = useQueryStates(credentialParams)
  const [isOpening, startOpening] = useTransition()
  const [enrollment, setEnrollment] = useState<{
    connection: CredentialConnection
    credential?: IntegrationCredential
  } | null>(null)
  const [disconnecting, setDisconnecting] = useState<IntegrationCredential | null>(null)
  const selected = isOpening
    ? undefined
    : integration.credentials.find((credential) => credential.id === view.credential)
  const connections = catalog?.connections ?? []
  const selectedScope = selected?.scope
  const workspace =
    selectedScope?.kind === 'workspace'
      ? workspaces.find((entry) => entry.id === selectedScope.id)
      : undefined
  const allowedPeople = workspace
    ? eligiblePeople.filter((person) => workspace.memberIds.includes(person.id))
    : selectedScope?.kind === 'organization'
      ? eligiblePeople
      : []
  function canReconnect(credential: IntegrationCredential) {
    if (credential.providerId === 'microsoft-dataverse' && !credential.instanceUrl) return false
    return (
      credential.role === 'admin' &&
      credential.scope.kind !== 'organization-managed' &&
      credential.canReconnect &&
      connections.some(
        (entry) => entry.providerId === credential.providerId && entry.kind === credential.type
      )
    )
  }
  function open(credential: IntegrationCredential) {
    startOpening(async () => {
      await setView({})
      await setView({ credential: credential.id }, { history: 'push', scroll: false })
    })
  }
  function save(credential: IntegrationCredential) {
    const current = integration.credentials.find((entry) => entry.id === credential.id)
    if (!current || current.role !== 'admin' || current.scope.kind === 'organization-managed')
      return
    if (current.displayName !== credential.displayName) assertAvailableName(credential)
    onChange({
      ...integration,
      credentials: integration.credentials.map((entry) =>
        entry.id === credential.id ? credential : entry
      ),
    })
  }
  function assertAvailableName(credential: IntegrationCredential) {
    const scope = credential.scope
    if (
      (credential.type !== 'oauth' && credential.type !== 'service_account') ||
      (scope.kind !== 'workspace' && scope.kind !== 'organization')
    )
      return
    if (
      knownCredentials.some(
        (entry) =>
          entry.id !== credential.id &&
          entry.type === credential.type &&
          entry.scope.kind === scope.kind &&
          entry.scope.id === scope.id &&
          (credential.type === 'oauth'
            ? entry.displayName.trim().toLowerCase() === credential.displayName.trim().toLowerCase()
            : entry.providerId === credential.providerId &&
              entry.displayName === credential.displayName)
      )
    )
      throw new Error(`A credential with this display name already exists in this ${scope.kind}.`)
  }
  function remove(credential: IntegrationCredential) {
    const current = integration.credentials.find((entry) => entry.id === credential.id)
    if (!current || current.role !== 'admin' || current.scope.kind === 'organization-managed')
      return
    commitRemoval(current)
  }
  function commitRemoval(credential: IntegrationCredential) {
    onChange({
      ...integration,
      credentials: integration.credentials.filter((entry) => entry.id !== credential.id),
    })
    if (selected?.id === credential.id) void setView({ credential: null })
  }
  function leave(credential: IntegrationCredential) {
    const current = integration.credentials.find((entry) => entry.id === credential.id)
    if (!current || (current.scope.kind !== 'workspace' && current.scope.kind !== 'organization'))
      return
    const members = current.members.filter((member) => member.status === 'active')
    const member = members.find((entry) => entry.userId === viewer.id)
    if (
      !member ||
      member.roleSource === 'workspace-admin' ||
      (member.explicitAdmin && members.filter((entry) => entry.explicitAdmin).length <= 1)
    )
      return
    commitRemoval(current)
  }
  function reconnect(credential: IntegrationCredential) {
    if (!canReconnect(credential)) return
    const connection = connections.find(
      (entry) => entry.providerId === credential.providerId && entry.kind === credential.type
    )
    if (connection) setEnrollment({ connection, credential })
  }
  function connect(draft: CredentialDraft) {
    if (!enrollment || (!enrollment.credential && !integration.canAddCredential)) return
    if (enrollment.credential) {
      const current = integration.credentials.find(
        (entry) => entry.id === enrollment.credential?.id
      )
      if (!current) return
      save({
        ...current,
        displayName: draft.displayName,
        description: draft.description,
        accountLabel: draft.accountLabel ?? current.accountLabel,
        status: 'active',
      })
      setEnrollment(null)
      return
    }
    const credential: IntegrationCredential = {
      id: generateId(),
      appId: integration.providerId,
      providerId: enrollment.connection.providerId,
      type: enrollment.connection.kind,
      displayName: draft.displayName,
      description: draft.description,
      accountLabel: draft.accountLabel,
      instanceUrl: draft.instanceUrl,
      role: 'admin',
      status: 'active',
      canReconnect: true,
      scope: enrollment.connection.personalOnly
        ? { kind: 'personal', ownerId: viewer.id }
        : { kind: 'organization', id: organization.id, name: organization.name },
      members: enrollment.connection.personalOnly
        ? []
        : [
            {
              ...viewer,
              userId: viewer.id,
              role: 'admin',
              roleSource: 'explicit',
              explicitAdmin: true,
              status: 'active',
            },
          ],
    }
    assertAvailableName(credential)
    onChange({ ...integration, credentials: [...integration.credentials, credential] })
    setEnrollment(null)
  }
  return (
    <>
      {selected ? (
        <CredentialDetail
          key={selected.id}
          credential={selected}
          integrationName={integration.name}
          viewer={viewer}
          people={allowedPeople}
          onBack={() => void setView({ credential: null })}
          onChange={save}
          onReconnect={canReconnect(selected) ? () => reconnect(selected) : undefined}
          onDisconnect={() => setDisconnecting(selected)}
          onLeave={() => leave(selected)}
        />
      ) : (
        <>
          <ProviderHeading
            name={integration.name}
            description={integration.description}
            providerId={integration.providerId}
          />
          <IntegrationIdea
            providerId={integration.providerId}
            name={integration.name}
            example={
              catalog?.example ??
              `${integration.description.replace(/[.!?]+$/, '')}. Bring that context into your next conversation with Sim.`
            }
          />
          <IntegrationControls
            leading={<IntegrationUsage people={people ?? []} total={peopleTotal} />}
          >
            <Button
              variant='quiet'
              size='compact'
              icon='I082'
              render={
                <Link href={integration.setupGuideUrl} target='_blank' rel='noopener noreferrer' />
              }
            >
              Docs
            </Button>
            {integration.canAddCredential && connections.length === 1 ? (
              <Button
                icon='I074'
                size='compact'
                onClick={() => setEnrollment({ connection: connections[0] })}
              >
                Connect integration
              </Button>
            ) : integration.canAddCredential && connections.length > 1 ? (
              <ActionMenu
                label='Connect integration'
                triggerSize='compact'
                triggerVariant='secondary'
                icon={null}
                tooltip={false}
                actions={connections.map((connection) => ({
                  id: connection.id,
                  label: connection.label,
                  onSelect: () => setEnrollment({ connection }),
                }))}
              />
            ) : null}
          </IntegrationControls>
          <CredentialList
            integrationName={integration.name}
            credentials={integration.credentials}
            onOpen={open}
          />
          {catalog && (
            <IntegrationCapabilities
              catalog={catalog}
              addedSkills={addedSkills}
              onAddSkill={onAddSkill}
            />
          )}
        </>
      )}
      {enrollment && (
        <CredentialConnect
          key={`connect:${enrollment.credential?.id ?? enrollment.connection.id}`}
          integrationName={integration.name}
          connection={enrollment.connection}
          access={integration.searchReads}
          initial={enrollment.credential}
          onClose={() => setEnrollment(null)}
          onSubmit={connect}
        />
      )}
      {disconnecting && (
        <Modal
          open
          title={`Disconnect ${disconnecting.displayName}?`}
          description='People and workflows using this credential will lose access.'
          variant='confirm'
          destructive
          confirmLabel='Disconnect'
          onOpenChange={(open) => {
            if (!open) setDisconnecting(null)
          }}
          onConfirm={() => remove(disconnecting)}
        />
      )}
    </>
  )
}
