import { resolvePrincipalSubject, type WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { getUserEmailById } from '@/lib/users/queries'
import type { StartBlockRunSubject } from '@/executor/types'

export interface StartBlockRunIdentity {
  subject: StartBlockRunSubject | null
}

/** Projects the authenticated execution principal into workflow-visible identity metadata. */
export async function resolveStartBlockRunIdentity(
  principal: WorkflowExecutionPrincipal
): Promise<StartBlockRunIdentity> {
  const subject = resolvePrincipalSubject(principal)
  if (!subject) return { subject: null }

  switch (subject.kind) {
    case 'sim_user': {
      const email = await getUserEmailById(subject.userId)
      return { subject: { ...subject, email } }
    }
    case 'authenticated_email':
      return { subject: { ...subject } }
    case 'external_user':
      return { subject: { ...subject } }
  }
}
