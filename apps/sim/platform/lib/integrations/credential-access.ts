import type {
  CredentialMember,
  IntegrationCredential,
} from '@/platform/lib/integrations/credential-model'

/** Sharing is separate from the credential's effective administration role. */
export function canShareCredential(credential: IntegrationCredential) {
  return (
    credential.type !== 'personal_token' &&
    (credential.scope.kind === 'workspace' || credential.scope.kind === 'organization')
  )
}

/** Fixture metadata preserves inherited grants and the active explicit administrator floor. */
export function validCredentialMembers(
  credential: IntegrationCredential,
  next: readonly CredentialMember[]
) {
  const previous = credential.members
  const nextById = new Map(next.map((member) => [member.userId, member]))
  if (nextById.size !== next.length) return false
  if (
    previous.some((member) => {
      const proposed = nextById.get(member.userId)
      return proposed && proposed.roleSource !== member.roleSource
    })
  )
    return false
  if (!canShareCredential(credential)) {
    return (
      next.length === previous.length &&
      previous.every((member) => {
        const proposed = nextById.get(member.userId)
        return (
          proposed?.role === member.role &&
          proposed.status === member.status &&
          proposed.roleSource === member.roleSource &&
          proposed.explicitAdmin === member.explicitAdmin
        )
      })
    )
  }
  if (
    previous.some((member) => {
      const proposed = nextById.get(member.userId)
      return (
        member.roleSource !== 'explicit' &&
        (!proposed ||
          proposed.role !== member.role ||
          proposed.status !== member.status ||
          proposed.roleSource !== member.roleSource ||
          proposed.explicitAdmin !== member.explicitAdmin)
      )
    })
  )
    return false
  const priorIds = new Set(previous.map((member) => member.userId))
  if (next.some((member) => !priorIds.has(member.userId) && member.roleSource !== 'explicit'))
    return false
  const hadAdmin = previous.some((member) => member.status === 'active' && member.explicitAdmin)
  return !hadAdmin || next.some((member) => member.status === 'active' && member.explicitAdmin)
}
