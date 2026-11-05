'use client'

import { useState } from 'react'
import {
  ActionRow,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { MothershipByok } from '@/platform/app/(shell)/settings/_components/sections/mothership/mothership-byok'
import { MothershipLicenses } from '@/platform/app/(shell)/settings/_components/sections/mothership/mothership-licenses'
import { MothershipOverview } from '@/platform/app/(shell)/settings/_components/sections/mothership/mothership-overview'
import { DateRangePicker, SegmentedControl, Select } from '@/platform/design-system/components'
import {
  MOTHERSHIP_ENVIRONMENTS,
  MOTHERSHIP_VIEWS,
  useMothershipView,
} from '@/platform/lib/data/mothership-admin'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'

interface MothershipPanelProps {
  organization: PlatformOrganization
  referenceTime: number
}

function lastWeek(referenceTime: number) {
  const minute = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 16)
  return { start: minute(referenceTime - 7 * 86400000), end: minute(referenceTime) }
}

export function MothershipPanel({ organization, referenceTime }: MothershipPanelProps) {
  const { tab, env, change } = useMothershipView()
  const actions = useFixtureSettingsActions()
  const [range, setRange] = useState(() => lastWeek(actions?.referenceTime ?? referenceTime))
  const validRange =
    range.start <= range.end &&
    [range.start, range.end].every((date) => Number.isFinite(Date.parse(`${date}Z`)))
  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <ActionRow>
            <SegmentedControl
              label='Mothership views'
              value={tab}
              options={MOTHERSHIP_VIEWS}
              onSelect={(value) => change({ tab: value })}
            />
          </ActionRow>
        }
      >
        <Select
          label='Environment'
          value={env}
          options={
            env === 'default'
              ? [{ value: 'default', label: 'Default' }, ...MOTHERSHIP_ENVIRONMENTS]
              : MOTHERSHIP_ENVIRONMENTS
          }
          onValueChange={(next) => {
            const option = MOTHERSHIP_ENVIRONMENTS.find(({ value }) => value === next)
            if (option && option.value !== env) change({ env: option.value })
          }}
        />
      </SectionToolbar>
      {tab === 'overview' && (
        <>
          <DateRangePicker
            label='Reporting period (UTC)'
            withTime
            value={range}
            error={validRange ? undefined : 'Choose an end time after the start.'}
            onValueChange={(next) => {
              if (next) setRange(next)
            }}
          />
          {validRange && (
            <MothershipOverview
              key={`${env}/${range.start}/${range.end}`}
              env={env}
              start={new Date(`${range.start}Z`).toISOString()}
              end={new Date(`${range.end}Z`).toISOString()}
            />
          )}
        </>
      )}
      {tab === 'licenses' && <MothershipLicenses key={env} env={env} organization={organization} />}
      {tab === 'byok' && <MothershipByok organization={organization} />}
    </SectionStack>
  )
}
