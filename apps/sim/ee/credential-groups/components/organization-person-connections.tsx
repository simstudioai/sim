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
import { getCredentialGroupProviderService } from '@/lib/credential-groups/providers'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'

interface OrganizationPersonConnectionsProps {
  person: CredentialGroupEnrollmentDetail
}

export function OrganizationPersonConnections({ person }: OrganizationPersonConnectionsProps) {
  const connectionsRef = useRef<HTMLSpanElement>(null)

  const connections = person.connections
    .filter((connection) => connection.status === 'active')
    .map((connection) => {
      const display =
        connection.provider === 'gitlab'
          ? resolveCredentialDisplay({
              type: 'personal_token',
              providerId: 'gitlab',
              displayName: 'GitLab',
            })
          : undefined
      const service =
        connection.provider !== 'gitlab'
          ? getCredentialGroupProviderService(connection.provider)
          : undefined
      return {
        key: `${connection.provider}:${connection.status}`,
        name: service?.name ?? display?.detailTitle ?? 'GitLab',
        icon: service?.icon ?? display?.icon ?? undefined,
        count: connection.count,
      }
    })
  const accounts = [
    ...connections,
    ...person.apiKeyConnections
      .filter((connection) => connection.status === 'active')
      .map((connection) => ({
        key: `api-key:${connection.optionId}`,
        name: connection.name,
        count: 1,
        icon: undefined,
      })),
    ...person.mcpConnections
      .filter((connection) => connection.status === 'active')
      .map((connection) => ({
        key: `mcp:${connection.mcpServerId}`,
        name: connection.name,
        count: 1,
        icon: undefined,
      })),
  ]

  const visible = person.status !== 'revoked' && accounts.length > 0
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
