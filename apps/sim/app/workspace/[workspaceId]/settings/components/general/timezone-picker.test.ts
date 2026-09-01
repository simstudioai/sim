/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  AUTO_TIMEZONE_OPTION_VALUE,
  getTimezonePickerPresentation,
  INVALID_TIMEZONE_OPTION_VALUE,
  timezonePreferenceFromPickerValue,
} from '@/app/workspace/[workspaceId]/settings/components/general/timezone-picker'

const timezoneOptions = [{ label: 'Los Angeles (GMT-07:00)', value: 'America/Los_Angeles' }]

describe('getTimezonePickerPresentation', () => {
  it('shows an unset preference as an explicit browser-managed option', () => {
    expect(getTimezonePickerPresentation(null, 'America/Los_Angeles', timezoneOptions)).toEqual({
      value: AUTO_TIMEZONE_OPTION_VALUE,
      options: [
        { label: 'Auto: Los Angeles (GMT-07:00)', value: AUTO_TIMEZONE_OPTION_VALUE },
        ...timezoneOptions,
      ],
    })
  })

  it('keeps a valid saved timezone selected independently of Auto', () => {
    expect(
      getTimezonePickerPresentation('America/Los_Angeles', 'America/Los_Angeles', timezoneOptions)
        .value
    ).toBe('America/Los_Angeles')
  })

  it('adds a valid saved timezone that is absent from the curated options', () => {
    expect(getTimezonePickerPresentation('Etc/GMT+5', 'UTC', timezoneOptions)).toEqual({
      value: 'Etc/GMT+5',
      options: [
        { label: 'Auto: UTC', value: AUTO_TIMEZONE_OPTION_VALUE },
        { label: 'Etc/GMT+5', value: 'Etc/GMT+5' },
        ...timezoneOptions,
      ],
    })
  })

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

  it('persists Auto as an unset preference', () => {
    expect(timezonePreferenceFromPickerValue(AUTO_TIMEZONE_OPTION_VALUE)).toBeNull()
    expect(timezonePreferenceFromPickerValue('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(timezonePreferenceFromPickerValue(INVALID_TIMEZONE_OPTION_VALUE)).toBeUndefined()
  })
})
