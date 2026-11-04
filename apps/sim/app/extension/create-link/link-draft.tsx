'use client'

import { useEffect, useState } from 'react'
import { organizationRoutes } from '@/lib/navigation/paths'
import { consumeLinkDraft } from '@/app/extension/create-link/destination'
import { SimLinkModal } from '@/app/o/[organizationId]/links/sim-link-modal'

interface LinkDraftProps {
  organization: { id: string; name: string }
}

export function LinkDraft({ organization }: LinkDraftProps) {
  const [url, setUrl] = useState<string>()
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    const initial = consumeLinkDraft()
    setUrl((current) => current ?? initial)
  }, [])
  if (closed) return <main className='grid h-dvh place-items-center text-small'>Draft closed.</main>
  if (url === undefined) return null
  return (
    <SimLinkModal
      organizationId={organization.id}
      organizationName={organization.name}
      initialUrl={url}
      onClose={() => {
        setClosed(true)
        window.close()
      }}
      onSaved={() => window.location.replace(organizationRoutes(organization.id).simLinks)}
    />
  )
}
