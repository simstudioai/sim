'use client'

import { type ComponentProps, useState } from 'react'
import {
  Avatar,
  Button,
  Checkbox,
  CopyField,
  DataTable,
  DatePicker,
  DateRangePicker,
  EmptyState,
  FileField,
  Icon,
  IconButton,
  InlineNotice,
  MultiSelect,
  Pagination,
  PlatformSurface,
  RecipientField,
  SearchableSelect,
  SecretField,
  StatusTag,
  Switch,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSurface,
} from '@/platform/design-system/components/settings-section/settings-section'
import styles from '@/platform/preview/workbench.module.css'

const TEAMS = Array.from({ length: 60 }, (_, index) => ({
  value: `team-${index}`,
  label: `Team ${index + 1}`,
}))
const PAGE_SIZE = 40
const PEOPLE = Array.from({ length: 400 }, (_, index) => ({
  id: `person-${index}`,
  name: `Person ${String(index + 1).padStart(3, '0')}`,
  status: index % 5 === 0 ? 'Invited' : 'Active',
}))
type Sort = NonNullable<ComponentProps<typeof DataTable>['sort']>
type Recipients = NonNullable<ComponentProps<typeof RecipientField>['recipients']>

function isCompanyAddress(address: string) {
  return address.endsWith('@example.test')
}

function FormControls() {
  const [checked, setChecked] = useState(true)
  const [team, setTeam] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [teams, setTeams] = useState<string[]>([])
  const [day, setDay] = useState<string | null>(null)
  const [range, setRange] = useState<ComponentProps<typeof DateRangePicker>['value']>(null)
  const [recipients, setRecipients] = useState<Recipients>([])
  const [file, setFile] = useState<string | null>(null)
  const [secret, setSecret] = useState('initial-secret-value')
  const matches = TEAMS.filter(({ label }) => label.toLowerCase().includes(query.toLowerCase()))
  const selectedTeam = TEAMS.find(({ value }) => value === team)
  return (
    <div className={styles.stack}>
      <Checkbox
        label='Allow member invites'
        description='Members can invite people to this organization.'
        checked={checked}
        onCheckedChange={setChecked}
      />
      <Checkbox label='Partially applied' indeterminate />
      <Checkbox label='Unavailable option' disabled />
      <Switch label='Unavailable toggle' disabled />
      <SearchableSelect
        label='Server search'
        searchLabel='Search teams'
        placeholder='Choose a team'
        options={matches.slice(0, 20)}
        value={team}
        selectedLabel={selectedTeam?.label}
        onValueChange={setTeam}
        search={{ query, onQueryChange: setQuery }}
      />
      <SearchableSelect
        label='Failed server search'
        searchLabel='Search teams'
        options={[]}
        value={null}
        search={{
          query: '',
          onQueryChange: () => undefined,
          error: 'Teams could not be loaded.',
          onRetry: () => undefined,
        }}
      />
      <MultiSelect
        label='Teams'
        searchLabel='Filter teams'
        options={TEAMS}
        value={teams}
        onValueChange={setTeams}
      />
      <DatePicker
        label='Start date'
        value={day}
        onValueChange={setDay}
        max='2030-12-31'
        clearable
      />
      <DateRangePicker label='Period' value={range} onValueChange={setRange} withTime clearable />
      <CopyField
        label='Endpoint'
        value='https://example.test/scim/v2'
        hint='Paste into your IdP.'
      />
      <SecretField label='Token' value={secret} onChange={setSecret} copyable />
      <FileField
        label='Spreadsheet'
        accept='.csv,.xlsx'
        selection={file ? { name: file, detail: 'Ready to import' } : undefined}
        onFileChange={({ name }) => setFile(name)}
        onClear={() => setFile(null)}
      />
      <RecipientField
        label='Company addresses'
        recipients={recipients}
        onRecipientsChange={setRecipients}
        validate={isCompanyAddress}
        error={
          recipients.some(({ invalid }) => invalid) ? 'Use an example.test address.' : undefined
        }
        hint='Separate addresses with commas.'
      />
    </div>
  )
}

function StatusControls() {
  const [page, setPage] = useState(1)
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <StatusTag label='Invited' />
        <StatusTag label='Syncing' intent='info' live />
        <StatusTag label='Active' intent='success' />
        <StatusTag label='Expiring' intent='warning' />
        <StatusTag label='Failed' intent='danger' />
      </div>
      <InlineNotice message='Directory sync runs every hour.' intent='info' />
      <InlineNotice
        title='Seats are full'
        message='Add seats before inviting more people.'
        intent='warning'
        action={<Button size='compact'>Add seats</Button>}
      />
      <InlineNotice message='The last sync failed.' intent='danger' />
      <SettingsSurface>
        <SettingsRow
          label='Ada Lovelace'
          description='ada@example.test'
          leading={<Avatar name='Ada Lovelace' />}
        >
          <StatusTag label='Owner' />
        </SettingsRow>
      </SettingsSurface>
      <EmptyState
        title='No links yet'
        description='Links appear here once someone creates one.'
        graphic={<Icon name='I037' />}
      />
      <Pagination label='Requests pages' page={page} hasNext={page < 3} onPageChange={setPage} />
    </div>
  )
}

function DataControls() {
  const [sort, setSort] = useState<Sort>({ column: 'name', direction: 'asc' })
  const [loaded, setLoaded] = useState(PAGE_SIZE)
  const ordered = sort.direction === 'asc' ? PEOPLE : [...PEOPLE].reverse()
  const rows = ordered.slice(0, loaded).map((person) => ({
    id: person.id,
    href: `#${person.id}`,
    values: { name: person.name },
    cells: {
      status: (
        <StatusTag
          label={person.status}
          intent={person.status === 'Active' ? 'success' : 'neutral'}
        />
      ),
    },
    action: <IconButton label={`More actions for ${person.name}`} icon='I108' />,
  }))
  return (
    <DataTable
      title='People'
      virtualized
      columns={[
        { key: 'name', label: 'Name', kind: 'text', sortable: true },
        { key: 'status', label: 'Status', kind: 'status' },
      ]}
      rows={rows}
      sort={sort}
      onSortChange={setSort}
      loadMore={{
        hasMore: loaded < PEOPLE.length,
        onLoadMore: () => setLoaded((current) => current + PAGE_SIZE),
      }}
    />
  )
}

interface ControlsWorkbenchProps {
  theme: 'light' | 'dark'
}

/** Exercises controls that have no Paper master, in the states a browser check can reach. */
export function ControlsWorkbench({ theme }: ControlsWorkbenchProps) {
  return (
    <PlatformSurface theme={theme}>
      <main className={styles.page}>
        <div className={styles.sheet}>
          <section className={styles.section} aria-label='Form controls'>
            <FormControls />
            <StatusControls />
          </section>
          <section className={styles.section} aria-label='Data table'>
            <div className={styles.catalog}>
              <DataControls />
            </div>
          </section>
        </div>
      </main>
    </PlatformSurface>
  )
}
