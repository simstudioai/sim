'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useSession } from '@/lib/auth/client'
import { toast } from '@/lib/toast/sink'
import {
  useLeaveCredential,
  useRemoveWorkspaceCredentialMember,
  useUpdateWorkspaceCredential,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
} from '@/hooks/queries/credentials'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import {
  credentialMemberChanges,
  toCredentialMembers,
  toIntegrationPeople,
} from '@/platform/lib/data/integration-credentials-model'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import { canShareCredential } from '@/platform/lib/integrations/credential-access'
import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

/** The signed-in person, as the credential pages name them; absent until the session loads. */
export function useIntegrationViewer(): IntegrationPerson | undefined {
  const user = useSession().data?.user
  return user
    ? {
        id: user.id,
        name: user.name || user.email,
        email: user.email,
        src: user.image ?? undefined,
      }
    : undefined
}

/**
 * One workspace credential with its grants, the workspace people it can be shared with, and the
 * edits the credential page proposes, sent through the same credential and member operations
 * legacy's credential page used. A credential only its owner holds reads no grants. Each failure
 * is a toast, and the reads settle the page back on the server's state.
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
  const upsert = useUpsertWorkspaceCredentialMember()
  const remove = useRemoveWorkspaceCredentialMember()
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
    save(next: IntegrationCredential) {
      if (!current || !viewer) return
      if (next.displayName !== current.displayName || next.description !== current.description)
        update.mutate(
          {
            credentialId: current.id,
            displayName: next.displayName,
            description: next.description || null,
          },
          {
            onError: (error) =>
              toast.error("Couldn't save this credential", {
                description: getErrorMessage(error, 'Please try again in a moment.'),
              }),
          }
        )
      const { upserts, removals } = credentialMemberChanges(
        current.members,
        next.members,
        viewer.id
      )
      if (!upserts.length && !removals.length) return
      void Promise.allSettled([
        ...upserts.map(({ userId, role }) =>
          upsert.mutateAsync({ credentialId: current.id, userId, role })
        ),
        ...removals.map((userId) => remove.mutateAsync({ credentialId: current.id, userId })),
      ]).then((results) => {
        const rejected = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
        if (rejected)
          toast.error("Couldn't change access", {
            description: getErrorMessage(rejected.reason, 'Please try again in a moment.'),
          })
      })
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
