import { useState } from 'react'
import { generateId } from '@sim/utils/id'
import styles from '@/platform/app/(shell)/integrations/_components/integration-people/integration-people.module.css'
import {
  ActionMenu,
  Button,
  EmptyState,
  Modal,
  RecipientField,
  SearchField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import type { IntegrationPerson, OrganizationIntegration } from '@/platform/lib/integrations/model'

const STATUS: Record<IntegrationPerson['status'], string> = {
  draft: 'Invitation draft',
  completed: 'Connected',
  invited: 'Invited',
  in_progress: 'Connecting',
  expired: 'Invitation expired',
  delivery_failed: 'Delivery failed',
  revoked: 'Access revoked',
}

interface IntegrationPeopleProps {
  integration: OrganizationIntegration
  onChange: (next: OrganizationIntegration) => void
}

export function IntegrationPeople({ integration, onChange }: IntegrationPeopleProps) {
  const [invite, setInvite] = useState(false)
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<{
    kind: 'revoke' | 'resend'
    person: IntegrationPerson
  } | null>(null)

  function addDrafts(form: FormData) {
    const people = new Map(integration.people.map((person) => [person.email.toLowerCase(), person]))
    for (const address of form.getAll('recipients')) {
      if (typeof address !== 'string') continue
      const key = address.toLowerCase()
      const current = people.get(key)
      if (!current || current.status === 'revoked')
        people.set(key, { id: current?.id ?? generateId(), email: address, status: 'draft' })
    }
    onChange({ ...integration, people: [...people.values()] })
  }

  const results = integration.people.filter((person) =>
    person.email.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <section aria-label='People' className={styles.roster}>
      <header className={styles.sectionHeader}>
        <h2 data-type='T093'>People</h2>
        <Button size='compact' onClick={() => setInvite(true)}>
          Invite people
        </Button>
      </header>
      {integration.people.length > 0 && (
        <SearchField label='Search people' placeholder='Search people…' onValueChange={setQuery} />
      )}
      {results.length > 0 ? (
        <SettingsSurface>
          {results.map((person) => (
            <SettingsRow key={person.id} label={person.email} description={STATUS[person.status]}>
              {person.status === 'draft' ? (
                <Button
                  variant='quiet'
                  size='compact'
                  onClick={() =>
                    onChange({
                      ...integration,
                      people: integration.people.filter((entry) => entry.id !== person.id),
                    })
                  }
                >
                  Discard draft
                </Button>
              ) : (
                person.status !== 'revoked' && (
                  <ActionMenu
                    label={`Actions for ${person.email}`}
                    icon='I108'
                    triggerSize='compact'
                    tooltip={false}
                    actions={[
                      ...(person.status !== 'completed'
                        ? [
                            {
                              id: 'resend',
                              label: 'Resend invitation',
                              onSelect: () => setAction({ kind: 'resend', person }),
                            },
                          ]
                        : []),
                      {
                        id: 'revoke',
                        label: 'Revoke access',
                        destructive: true,
                        separatorBefore: person.status !== 'completed',
                        onSelect: () => setAction({ kind: 'revoke', person }),
                      },
                    ]}
                  />
                )
              )}
            </SettingsRow>
          ))}
        </SettingsSurface>
      ) : (
        <EmptyState title={query.trim() ? 'No matching people' : 'No people yet'} />
      )}
      {invite && (
        <Modal
          open
          onOpenChange={setInvite}
          title='Invite people'
          description='Choose who should receive an invitation to connect their account.'
          confirmLabel='Save invitation draft'
          onConfirm={addDrafts}
        >
          <RecipientField
            required
            maxRecipients={100}
            label='Email addresses'
            name='recipients'
            placeholder='name@company.com'
          />
        </Modal>
      )}
      {action?.kind === 'resend' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title='Resend invitation'
          description={`Send another invitation to ${action.person.email}.`}
          confirmLabel='Resend invitation'
          confirmDisabled
        />
      )}
      {action?.kind === 'revoke' && (
        <Modal
          open
          onOpenChange={() => setAction(null)}
          title='Revoke organization access?'
          variant='confirm'
          destructive
          confirmLabel='Revoke access'
          description={`This revokes ${action.person.email}’s enrollment and its connected accounts across the organization.`}
          onConfirm={() =>
            onChange({
              ...integration,
              people: integration.people.map((entry) =>
                entry.id === action.person.id ? { ...entry, status: 'revoked' } : entry
              ),
            })
          }
        />
      )}
    </section>
  )
}
