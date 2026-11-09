'use client'

import { useState } from 'react'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import {
  ActionRow,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { MothershipByok } from '@/app/(product)/o/[organizationId]/settings/_components/sections/mothership/mothership-byok'
import { MothershipLicenses } from '@/app/(product)/o/[organizationId]/settings/_components/sections/mothership/mothership-licenses'
import { MothershipOverview } from '@/app/(product)/o/[organizationId]/settings/_components/sections/mothership/mothership-overview'
import {
  MOTHERSHIP_ENVIRONMENTS,
  MOTHERSHIP_VIEWS,
  useMothershipView,
} from '@/platform/lib/data/mothership-admin'
import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'

interface MothershipPanelProps {
  referenceTime: number
}

function lastWeek(referenceTime: number) {
  const minute = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 16)
  return { start: minute(referenceTime - 7 * 86400000), end: minute(referenceTime) }
}

export function MothershipPanel({ referenceTime }: MothershipPanelProps) {
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
        <ChoiceMenu
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
      {tab === 'licenses' && <MothershipLicenses key={env} env={env} />}
      {tab === 'byok' && <MothershipByok />}
    </SectionStack>
  )
}
