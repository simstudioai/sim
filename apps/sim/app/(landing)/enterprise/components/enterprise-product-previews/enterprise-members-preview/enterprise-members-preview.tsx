'use client'

import { useState } from 'react'
import { ChipDropdown, ChipInput } from '@sim/emcn'
import { Building, Search } from '@sim/emcn/icons'
import {
  MemberRow,
  MemberSection,
} from '@/app/workspace/[workspaceId]/settings/components/member-list/member-list'

const MEMBERS = [
  { name: 'Morgan', email: 'morgan@example.com', role: 'owner' },
  { name: 'Alex', email: 'alex@example.com', role: 'admin' },
  { name: 'Jamie', email: 'jamie@example.com', role: 'member' },
  { name: 'Casey', email: 'casey@example.com', role: 'member' },
] as const

const ORGANIZATION_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
] as const

const WORKSPACE_ROLES = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
] as const

/** Real settings rows and role controls, with local sample data for the public preview. */
export function EnterpriseMembersPreview() {
  const [query, setQuery] = useState('')
  const [organizationRoles, setOrganizationRoles] = useState<Record<string, string>>({})
  const [workspaceRoles, setWorkspaceRoles] = useState<Record<string, string>>({})
  const filteredMembers = MEMBERS.filter((member) =>
    `${member.name} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <>
      <div className='-translate-x-1/2 absolute top-20 bottom-[-40px] left-1/2 w-[calc(100%-160px)] max-w-[1000px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-xs max-sm:top-8 max-sm:w-[calc(100%-40px)] max-lg:w-[calc(100%-80px)]'>
        <div className='flex h-11 items-center gap-2 border-[var(--border)] border-b px-4'>
          <Building aria-hidden='true' className='size-[14px] text-[var(--text-icon)]' />
          <span className='text-[var(--text-primary)] text-base'>Organization</span>
        </div>
        <div className='mx-auto flex max-h-[392px] max-w-[760px] flex-col gap-6 overflow-y-auto overscroll-contain px-4 py-4 max-sm:max-h-[304px] max-sm:gap-6 max-sm:px-4 max-sm:py-5'>
          <ChipInput
            aria-label='Search example organization members'
            className='shrink-0'
            icon={Search}
            placeholder='Search members...'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <MemberSection
            label={`Members (${MEMBERS.length})`}
            isEmpty={filteredMembers.length === 0}
            emptyText='No matching members'
          >
            {filteredMembers.map((member) => (
              <MemberRow
                key={member.email}
                name={member.name}
                email={member.email}
                image={null}
                status=''
                roleControl={
                  <ChipDropdown
                    aria-label={`Organization role for ${member.name}: ${ORGANIZATION_ROLES.find((option) => option.value === (organizationRoles[member.email] ?? member.role))?.label ?? 'Owner'}`}
                    value={organizationRoles[member.email] ?? member.role}
                    options={
                      member.role === 'owner'
                        ? [{ value: 'owner', label: 'Owner' }]
                        : ORGANIZATION_ROLES
                    }
                    onChange={(role) =>
                      setOrganizationRoles((roles) => ({ ...roles, [member.email]: role }))
                    }
                    disabled={member.role === 'owner'}
                    matchTriggerWidth={false}
                  />
                }
              />
            ))}
          </MemberSection>
          <MemberSection
            label={`Brightwave (${MEMBERS.length})`}
            isEmpty={filteredMembers.length === 0}
            emptyText='No matching workspace members'
          >
            {filteredMembers.map((member) => (
              <MemberRow
                key={member.email}
                name={member.name}
                email={member.email}
                image={null}
                status=''
                roleControl={
                  <ChipDropdown
                    aria-label={`Workspace role for ${member.name}: ${WORKSPACE_ROLES.find((option) => option.value === (workspaceRoles[member.email] ?? (member.role === 'owner' ? 'admin' : 'write')))?.label}`}
                    value={
                      workspaceRoles[member.email] ?? (member.role === 'owner' ? 'admin' : 'write')
                    }
                    options={WORKSPACE_ROLES}
                    onChange={(role) =>
                      setWorkspaceRoles((roles) => ({ ...roles, [member.email]: role }))
                    }
                    disabled={member.role === 'owner'}
                    matchTriggerWidth={false}
                  />
                }
              />
            ))}
          </MemberSection>
        </div>
      </div>
    </>
  )
}
