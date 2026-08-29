'use client'

import { ChipDropdown } from '@sim/emcn'
import { FILTER_SECTION_LABEL_CLASS } from '@/app/workspace/[workspaceId]/components'
import {
  RUN_RANGES,
  RUN_STATUS_OPTIONS,
  RUN_TRIGGER_OPTIONS,
  type RunRange,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'

/**
 * The Filter popover for the run list: the same axes the Logs page filters on,
 * in the same order, at the panel's scale.
 *
 * `ChipDropdown` rather than the Logs page's `ChipCombobox` — none of these
 * lists is long enough to search, and the combobox brings its own taller option
 * rows, which read as a different menu system beside the Sort menu two
 * centimetres away. `ChipDropdown` draws its rows with the shared
 * `dropdownMenuRowClass`, so every menu in this bar matches.
 *
 * Workflow and Folder are absent on purpose — the panel is already scoped to one
 * workflow, so filtering by workflow here would be a control with one option.
 */

const STATUS_OPTIONS = RUN_STATUS_OPTIONS.map((option) => ({ ...option }))
const TRIGGER_OPTIONS = RUN_TRIGGER_OPTIONS.map((option) => ({ ...option }))
const RANGE_OPTIONS = RUN_RANGES.map((option) => ({ value: option.value, label: option.label }))

interface RunsFilterPanelProps {
  statuses: string[]
  onStatusesChange: (values: string[]) => void
  triggers: string[]
  onTriggersChange: (values: string[]) => void
  range: RunRange
  onRangeChange: (range: RunRange) => void
}

export function RunsFilterPanel({
  statuses,
  onStatusesChange,
  triggers,
  onTriggersChange,
  range,
  onRangeChange,
}: RunsFilterPanelProps) {
  return (
    <div className='flex w-[196px] flex-col gap-3 p-2.5'>
      <div className='flex flex-col gap-[6px]'>
        <span className={FILTER_SECTION_LABEL_CLASS}>Status</span>
        <ChipDropdown
          size='sm'
          multiple
          value={statuses}
          onChange={onStatusesChange}
          options={STATUS_OPTIONS}
          allLabel='All statuses'
          className='w-full'
        />
      </div>

      <div className='flex flex-col gap-[6px]'>
        <span className={FILTER_SECTION_LABEL_CLASS}>Trigger</span>
        <ChipDropdown
          size='sm'
          multiple
          value={triggers}
          onChange={onTriggersChange}
          options={TRIGGER_OPTIONS}
          allLabel='All triggers'
          className='w-full'
        />
      </div>

      <div className='flex flex-col gap-[6px]'>
        <span className={FILTER_SECTION_LABEL_CLASS}>Time Range</span>
        <ChipDropdown
          size='sm'
          value={range}
          onChange={(value) => onRangeChange(value as RunRange)}
          options={RANGE_OPTIONS}
          placeholder='All time'
          className='w-full'
        />
      </div>
    </div>
  )
}
