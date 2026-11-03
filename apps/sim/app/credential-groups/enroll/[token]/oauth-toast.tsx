'use client'

import { useEffect, useRef } from 'react'
import { AuthNotification } from '@sim/auth-ui'
import { useQueryStates } from 'nuqs'
import {
  credentialGroupEnrollmentStatusParsers,
  credentialGroupEnrollmentStatusUrlKeys,
} from '@/app/credential-groups/enroll/[token]/search-params'

interface CredentialGroupOAuthToastProps {
  message: string
  variant: 'success' | 'error'
}

export function CredentialGroupOAuthToast({ message, variant }: CredentialGroupOAuthToastProps) {
  const [, setOAuthStatus] = useQueryStates(
    credentialGroupEnrollmentStatusParsers,
    credentialGroupEnrollmentStatusUrlKeys
  )
  const shownRef = useRef(false)

  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true

    void setOAuthStatus(
      { connected: null, mcp: null, mcpServerId: null, oauth: null, submitted: null },
      { history: 'replace', scroll: false }
    )
  }, [setOAuthStatus])

  return <AuthNotification type={variant}>{message}</AuthNotification>
}
