'use client'

import { useRef } from 'react'
import {
  ChipTag,
  cn,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeXClass,
  useScrollEdges,
} from '@sim/emcn'
import type { CredentialGroupEnrollmentDetail } from '@/lib/api/contracts/credential-groups'
import { personConnectionSummaries } from '@/ee/credential-groups/person-connections'

interface OrganizationPersonConnectionsProps {
  person: CredentialGroupEnrollmentDetail
}

export function OrganizationPersonConnections({ person }: OrganizationPersonConnectionsProps) {
  const connectionsRef = useRef<HTMLSpanElement>(null)

  const accounts = personConnectionSummaries(person)

  const visible = accounts.length > 0
  const edges = useScrollEdges(connectionsRef, { axis: 'x', enabled: visible })

  if (!visible) return null

  return (
    <span
      ref={connectionsRef}
      role='group'
      aria-label='Connected accounts'
      className={cn(
        scrollFadeXClass,
        'flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      )}
      {...scrollFadeAttributes(edges)}
    >
      {accounts.map(({ key, name, icon, count }) => (
        <ChipTag key={key} variant='gray' leftIcon={icon} className='max-w-[180px] shrink-0'>
          <OverflowText label={count > 1 ? `${name} (${count})` : name} />
        </ChipTag>
      ))}
    </span>
  )
}
