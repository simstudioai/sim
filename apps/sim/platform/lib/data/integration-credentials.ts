'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/client'
import { toast } from '@/lib/toast/sink'
import {
  useLeaveCredential,
  useSetWorkspaceCredentialMembers,
  useUpdateWorkspaceCredential,
  useWorkspaceCredentialMembers,
} from '@/hooks/queries/credentials'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import {
  credentialGrants,
  toCredentialMembers,
  toIntegrationPeople,
  toIntegrationPerson,
} from '@/platform/lib/data/integration-credentials-model'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import { canShareCredential } from '@/platform/lib/integrations/credential-access'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

/** The signed-in person, as the credential pages name them; absent until the session loads. */
export function useIntegrationViewer(): IntegrationPerson | undefined {
  const user = useSession().data?.user
  return user ? toIntegrationPerson(user) : undefined
}

/**
 * One workspace credential with its grants, the workspace people it can be shared with, and the
 * edits the credential page proposes. A credential only its owner holds reads no grants. Details
 * reject with the server's reason for the form to show; an access edit applies as one change, all
 * of it or none, and a failure is a toast while the grants read settles the table back.
 */
export function useWorkspaceCredentialAccess(
  workspaceId: string,
  credential: IntegrationCredential | undefined
) {
  const viewer = useIntegrationViewer()
  const shareable = Boolean(credential && canShareCredential(credential))
  const members = useWorkspaceCredentialMembers(shareable ? credential?.id : undefined)
  const permissions = useWorkspacePermissionsQuery(shareable ? workspaceId : undefined)
  const update = useUpdateWorkspaceCredential(workspaceId)
  const setMembers = useSetWorkspaceCredentialMembers()
  const leave = useLeaveCredential()
  const current =
    credential && (!shareable || members.data)
      ? {
          ...credential,
          members: members.data ? toCredentialMembers(members.data) : credential.members,
        }
      : undefined

  return {
    viewer,
    credential: current,
    people: toIntegrationPeople(permissions.data?.users ?? []),
    async saveDetails({ displayName, description }: { displayName: string; description: string }) {
      if (!current) return
      await update.mutateAsync({
        credentialId: current.id,
        displayName,
        description: description || null,
      })
    },
    saveAccess(next: IntegrationCredential) {
      if (!current || !viewer) return
      setMembers.mutate(
        {
          credentialId: current.id,
          members: credentialGrants(current.members, next.members, viewer.id),
        },
        {
          onError: (error) =>
            toast.error("Couldn't change access", {
              description: getErrorMessage(error, 'Please try again in a moment.'),
            }),
        }
      )
    },
    /** Gives up the viewer's own access, then `onLeft` takes them off the credential's page. */
    leave(onLeft: () => void) {
      if (!current) return
      leave.mutate(current.id, {
        onSuccess: onLeft,
        onError: (error) =>
          toast.error("Couldn't leave this credential", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          }),
      })
    },
  }
}
