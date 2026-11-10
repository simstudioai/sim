'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'
import { validCredentialMembers } from '@/platform/lib/integrations/credential-access'
import { manualCredentialAccess } from '@/platform/lib/integrations/manual-secret'

function useChanges() {
  const [edits, setEdits] = useState<Record<string, IntegrationResource | null>>({})
  return { edits, setEdits }
}

const Changes = createContext<ReturnType<typeof useChanges> | null>(null)

/** A fixture session's integration center edits, kept for the session and never written anywhere. */
export function IntegrationCenterChanges({ children }: { children: ReactNode }) {
  const changes = useChanges()
  return <Changes.Provider value={changes}>{children}</Changes.Provider>
}

/** Only typed metadata survives a dialog; credentials and authentication tokens never enter it. */
function resourceMetadata(resource: IntegrationResource): IntegrationResource {
  const { id, name, description, scope, owner, people, canEdit } = resource
  const identity = { id, name, description, scope, owner, people, canEdit }
  switch (resource.kind) {
    case 'skill':
      return {
        ...identity,
        kind: 'skill',
        instructions: resource.instructions,
        source: resource.source
          ? { providerId: resource.source.providerId, name: resource.source.name }
          : undefined,
      }
    case 'mcp':
      return { ...identity, kind: 'mcp', url: resource.url, auth: resource.auth }
    case 'credential':
      return {
        ...identity,
        kind: 'credential',
        key: resource.key,
        credentialType: resource.credentialType,
        appId: resource.appId,
        members: resource.members?.map(
          ({ id, userId, name, email, src, role, roleSource, explicitAdmin, status }) => ({
            id,
            userId,
            name,
            email,
            src,
            role,
            roleSource,
            explicitAdmin,
            status,
          })
        ),
      }
  }
}

export function useIntegrationCenterResources(data: IntegrationCenterData | null) {
  const changes = useContext(Changes)
  if (!changes) throw new Error('Integration center controls require the product layout')
  const { edits, setEdits } = changes
  const initial = data?.resources ?? []
  const ids = new Set(initial.map((resource) => resource.id))
  const resources = initial
    .map((resource) => (resource.id in edits ? edits[resource.id] : resource))
    .filter((resource): resource is IntegrationResource => Boolean(resource))
    .concat(
      Object.values(edits).filter((resource): resource is IntegrationResource =>
        Boolean(resource && !ids.has(resource.id))
      )
    )
  return {
    resources,
    save(resource: IntegrationResource) {
      if (!data) return
      const existing = resources.find((entry) => entry.id === resource.id)
      if (existing && !existing.canEdit) return
      if (
        existing?.kind === 'credential' &&
        resource.kind === 'credential' &&
        resource.members &&
        !validCredentialMembers(manualCredentialAccess(existing, data), resource.members)
      )
        return
      setEdits((current) => ({ ...current, [resource.id]: resourceMetadata(resource) }))
    },
    remove(id: string) {
      if (!data || !resources.find((resource) => resource.id === id)?.canEdit) return
      setEdits((current) => ({ ...current, [id]: null }))
    },
    leave(id: string) {
      if (!data) return
      const resource = resources.find((resource) => resource.id === id)
      if (resource?.kind !== 'credential') return
      const credential = manualCredentialAccess(resource, data)
      const member = credential.members.find(
        (member) => member.userId === data.viewer.id && member.status === 'active'
      )
      if (
        !member ||
        member.roleSource !== 'explicit' ||
        !validCredentialMembers(
          credential,
          credential.members.filter((member) => member.userId !== data.viewer.id)
        )
      )
        return
      setEdits((current) => ({ ...current, [id]: null }))
    },
  }
}
