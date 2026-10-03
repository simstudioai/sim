import { describe, expect, it } from 'vitest'
import {
  AUTO_TIMEZONE_OPTION_VALUE,
  getTimezonePickerPresentation,
  INVALID_TIMEZONE_OPTION_VALUE,
} from '@/app/workspace/[workspaceId]/settings/components/general/timezone-picker'

const timezoneOptions = [{ label: 'Los Angeles (GMT-07:00)', value: 'America/Los_Angeles' }]

describe('getTimezonePickerPresentation', () => {
  it('surfaces an invalid saved timezone without making it selectable', () => {
    expect(getTimezonePickerPresentation('Mars/Olympus', 'UTC', timezoneOptions)).toEqual({
      value: INVALID_TIMEZONE_OPTION_VALUE,
      options: [
        { label: 'Auto: UTC', value: AUTO_TIMEZONE_OPTION_VALUE },
        {
          label: 'Invalid: Mars/Olympus',
          value: INVALID_TIMEZONE_OPTION_VALUE,
          disabled: true,
        },
        ...timezoneOptions,
      ],
    })
  })
})
