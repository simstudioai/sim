import { resolvePrincipalSubject, type WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { getUserEmailById } from '@/lib/users/queries'
import type { StartBlockRunSubject } from '@/executor/types'

export interface StartBlockRunIdentity {
  subject: StartBlockRunSubject | null
  userEmail: string | null
}

/** Projects the authenticated execution principal into workflow-visible identity metadata. */
export async function resolveStartBlockRunIdentity(
  principal: WorkflowExecutionPrincipal
): Promise<StartBlockRunIdentity> {
  const subject = resolvePrincipalSubject(principal)
  if (!subject) return { subject: null, userEmail: null }

  switch (subject.kind) {
    case 'sim_user': {
      const email = await getUserEmailById(subject.userId)
      return {
        subject: { ...subject, email },
        userEmail: email,
      }
    }
    case 'authenticated_email':
      return { subject: { ...subject }, userEmail: subject.email }
    case 'external_user':
      return { subject: { ...subject }, userEmail: null }
  }
}
