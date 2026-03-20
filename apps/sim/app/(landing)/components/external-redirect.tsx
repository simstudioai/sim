'use client'

import { useEffect } from 'react'

interface ExternalRedirectProps {
  url: string
}

/** Redirects to an external URL when it is configured via an environment variable. */
export default function ExternalRedirect({ url }: ExternalRedirectProps) {
  useEffect(() => {
    if (url?.startsWith('http')) {
      window.location.href = url
    }
  }, [url])

  return null
}
