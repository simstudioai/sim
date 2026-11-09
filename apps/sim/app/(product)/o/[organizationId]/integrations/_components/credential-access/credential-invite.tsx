'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { SelectField } from '@sim/emcn/field'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/credential-access/credential-access.module.css'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'
import type { CredentialMember } from '@/platform/lib/integrations/credential-model'

interface CredentialInviteProps {
  people: readonly IntegrationPerson[]
  onAdd: (people: readonly IntegrationPerson[], role: CredentialMember['role']) => void
}

export function CredentialInvite({ people, onAdd }: CredentialInviteProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [role, setRole] = useState<CredentialMember['role']>('member')
  const available = people.filter((person) => selected.includes(person.id))
  return (
    <form
      className={styles.invite}
      aria-label='Add people'
      onSubmit={(event) => {
        event.preventDefault()
        if (!available.length) return
        onAdd(available, role)
        setSelected([])
      }}
    >
      <div className={styles.invitePeople}>
        <MultiSelect
          label='People'
          placeholder='Choose people…'
          searchLabel='Search people to add'
          options={people.map((person) => ({ value: person.id, label: person.name }))}
          value={selected}
          onValueChange={setSelected}
          disabled={!people.length}
          disabledReason='No additional people are available to add.'
        />
      </div>
      <SelectField
        label='Role'
        options={[
          { value: 'member', label: 'Member' },
          { value: 'admin', label: 'Admin' },
        ]}
        value={role}
        onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
      />
      <Button submit size='compact' variant='secondary' disabled={!available.length}>
        Add people
      </Button>
    </form>
  )
}
