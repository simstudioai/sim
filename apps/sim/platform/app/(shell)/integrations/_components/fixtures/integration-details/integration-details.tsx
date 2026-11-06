'use client'

import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { ConnectionAccess } from '@/platform/app/(shell)/integrations/_components/connection-access/connection-access'
import { CredentialConnect } from '@/platform/app/(shell)/integrations/_components/credential-connect/credential-connect'
import type { CredentialDraft } from '@/platform/app/(shell)/integrations/_components/credential-connect/types'
import { CredentialDetail } from '@/platform/app/(shell)/integrations/_components/credential-detail/credential-detail'
import { CredentialList } from '@/platform/app/(shell)/integrations/_components/credential-list/credential-list'
import {
  credentialParams,
  serializeCredential,
} from '@/platform/app/(shell)/integrations/_components/fixtures/integration-details/search-params'
import { IntegrationCapabilities } from '@/platform/app/(shell)/integrations/_components/integration-capabilities/integration-capabilities'
import { IntegrationControls } from '@/platform/app/(shell)/integrations/_components/integration-controls/integration-controls'
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
  viewer,
  eligiblePeople,
  workspaces,
  people,
  peopleTotal,
  catalog,
  addedSkills,
  onAddSkill,
}: IntegrationDetailsProps) {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [view, setView] = useQueryStates(credentialParams)
  const [enrollment, setEnrollment] = useState<{
    connection: CredentialConnection
    credential?: IntegrationCredential
  } | null>(null)
  const [disconnecting, setDisconnecting] = useState<IntegrationCredential | null>(null)
  const selected = integration.credentials.find((credential) => credential.id === view.credential)
  const connections = catalog?.connections ?? []
  const selectedScope = selected?.scope
  const workspace =
    selectedScope?.kind === 'workspace'
      ? workspaces.find((entry) => entry.id === selectedScope.id)
      : undefined
  const allowedPeople = workspace
    ? eligiblePeople.filter((person) => workspace.memberIds.includes(person.id))
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
  async function open(credential: IntegrationCredential) {
    await setView(view)
    router.push(
      serializeCredential(`${pathname}?${search.toString()}`, { credential: credential.id }),
      { scroll: false }
    )
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
      scope.kind !== 'workspace'
    )
      return
    if (
      knownCredentials.some(
        (entry) =>
          entry.id !== credential.id &&
          entry.type === credential.type &&
          entry.scope.kind === 'workspace' &&
          entry.scope.id === scope.id &&
          (credential.type === 'oauth'
            ? entry.displayName.trim().toLowerCase() === credential.displayName.trim().toLowerCase()
            : entry.providerId === credential.providerId &&
              entry.displayName === credential.displayName)
      )
    )
      throw new Error('A credential with this display name already exists in this workspace.')
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
    if (!current || current.scope.kind !== 'workspace') return
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
    const workspace = enrollment.connection.personalOnly
      ? undefined
      : workspaces.find((entry) => entry.id === draft.workspaceId)
    if (!enrollment.connection.personalOnly && !workspace) return
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
      scope: workspace
        ? { kind: 'workspace', id: workspace.id, name: workspace.name }
        : { kind: 'personal', ownerId: viewer.id },
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
            people={people}
            peopleTotal={peopleTotal}
          />
          <IntegrationControls
            leading={
              <Button
                variant='quiet'
                icon='I079'
                render={
                  <Link
                    href={integration.setupGuideUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                Docs
              </Button>
            }
          >
            {integration.canAddCredential && connections.length === 1 ? (
              <Button
                icon='I074'
                size='compact'
                onClick={() => setEnrollment({ connection: connections[0] })}
              >
                Add credential
              </Button>
            ) : integration.canAddCredential && connections.length > 1 ? (
              <ActionMenu
                label='Add credential'
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
            onOpen={(credential) => void open(credential)}
            onReconnect={reconnect}
            canReconnect={canReconnect}
            onDisconnect={setDisconnecting}
          />
          <ConnectionAccess integration={{ ...integration, requestedScopes: null }} />
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
          key={enrollment.credential?.id ?? enrollment.connection.id}
          integrationName={integration.name}
          connection={enrollment.connection}
          workspaces={workspaces}
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
