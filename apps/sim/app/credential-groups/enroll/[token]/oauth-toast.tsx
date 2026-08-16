'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@sim/emcn'
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
  const { toast } = useToast()
  const [, setOAuthStatus] = useQueryStates(
    credentialGroupEnrollmentStatusParsers,
    credentialGroupEnrollmentStatusUrlKeys
  )
  const shownRef = useRef(false)

  useEffect(() => {
    if (shownRef.current) return
    shownRef.current = true

    if (variant === 'success') toast.success(message)
    else toast.error(message)

    void setOAuthStatus(
      { connected: null, oauth: null, submitted: null },
      { history: 'replace', scroll: false }
    )
  }, [message, setOAuthStatus, toast, variant])

  return null
}
