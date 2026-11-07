'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { TextField } from '@sim/emcn/field'
import { CopyField } from '@sim/emcn/field/value-fields'
import { DatePicker } from '@sim/emcn/picker/date-picker'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import {
  ActionRow,
  FieldStack,
  LoadingState,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  type LicenseDraft,
  type MothershipEnv,
  useLicenseList,
} from '@/platform/lib/data/mothership-admin'
import { legacyRoutes, type PlatformOrganization } from '@/platform/lib/data/organization-model'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'
import { formatCalendarDate, formatTimestamp } from '@/platform/shared/time'

const COLUMNS = [
  { key: 'name', label: 'Enterprise', kind: 'text' },
  { key: 'validations', label: 'Validations', kind: 'number' },
  { key: 'expires', label: 'Expiration', kind: 'text' },
  { key: 'created', label: 'Created (UTC)', kind: 'text', showFrom: 'compact' },
] as const
const EMPTY_DRAFT: LicenseDraft = { name: '', approvalReference: '', expirationDate: null }

interface LicenseFormProps {
  generate: (draft: LicenseDraft) => string
}

function expirationDate(value: string | null | undefined) {
  if (!value) return 'Never'
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatCalendarDate(value, 'full')
    : formatTimestamp(Date.parse(value), 'UTC')
}

function LicenseForm({ generate }: LicenseFormProps) {
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [sample, setSample] = useState('')
  const name = draft.name.trim()
  const approval = draft.approvalReference.trim()
  useSettingsUnsavedGuard({
    isDirty: Boolean(name || approval || draft.expirationDate || sample),
    onDiscard: () => {
      setDraft(EMPTY_DRAFT)
      setSample('')
    },
  })
  return (
    <SettingsSection title='Generate license'>
      {sample ? (
        <FieldStack>
          <CopyField
            label='Sample license key'
            value={sample}
            hint='This sample appears once and cannot activate a deployment.'
          />
          <ActionRow>
            <Button size='compact' onClick={() => setSample('')}>
              Done
            </Button>
          </ActionRow>
        </FieldStack>
      ) : (
        <FieldStack>
          <TextField
            placeholder='Company name'
            label='Enterprise name'
            required
            value={draft.name}
            onChange={(value) => setDraft({ ...draft, name: value })}
          />
          <TextField
            placeholder='Order form or approval reference'
            label='Approval reference'
            required
            hint='Enter the signed order form or written approval reference.'
            value={draft.approvalReference}
            onChange={(value) => setDraft({ ...draft, approvalReference: value })}
          />
          <DatePicker
            label='Expiration'
            optional
            clearable
            value={draft.expirationDate}
            onValueChange={(value) => setDraft({ ...draft, expirationDate: value })}
          />
          <ActionRow>
            <Button
              variant='primary'
              size='compact'
              disabled={!name || !approval}
              onClick={() => {
                setSample(generate(draft))
                setDraft(EMPTY_DRAFT)
              }}
            >
              Generate license
            </Button>
          </ActionRow>
        </FieldStack>
      )}
    </SettingsSection>
  )
}

interface LicensesProps {
  env: MothershipEnv
  organization: PlatformOrganization
}

export function MothershipLicenses({ env, organization }: LicensesProps) {
  const list = useLicenseList(env)
  const actions = useFixtureSettingsActions()
  return (
    <SectionStack>
      {actions ? (
        <LicenseForm generate={(draft) => actions.generateSampleLicense(env, draft)} />
      ) : (
        <SettingsSection title='Generate license'>
          <SettingsRow
            label='Enterprise license'
            description='Issue a license using the approved order reference.'
          >
            <Button
              size='compact'
              render={
                <a href={legacyRoutes(organization).mothershipLicenses(env)}>Generate license</a>
              }
            >
              Generate license
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      {list.data ? (
        list.data.licenses.length ? (
          <DataTable
            title='All licenses'
            columns={COLUMNS}
            rows={list.data.licenses.map((lic) => ({
              id: lic.id,
              values: {
                name: lic.name,
                validations: lic.count,
                expires: expirationDate(lic.expiration_date),
                created: formatTimestamp(Date.parse(lic.created_at), 'UTC'),
              },
            }))}
          />
        ) : (
          <EmptyState title='No licenses in this environment' />
        )
      ) : list.status === 'error' ? (
        <FailureNotice message='Couldn’t load licenses.' onRetry={list.retry} />
      ) : (
        <LoadingState label='Loading licenses…' />
      )}
    </SectionStack>
  )
}
