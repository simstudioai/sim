'use client'

import {
  DESKTOP_ZOOM_PERCENTS,
  type DesktopZoomPercent,
  isDesktopZoomPercent,
} from '@sim/desktop-bridge'
import { ChipSelect } from '@sim/emcn'

const OPTIONS = DESKTOP_ZOOM_PERCENTS.map((zoom) => ({
  label: `${zoom}%`,
  value: String(zoom),
}))

interface DefaultZoomSelectProps {
  value: DesktopZoomPercent
  onChange: (value: DesktopZoomPercent) => void
  disabled?: boolean
  ariaLabel?: string
}

/** Shared default-zoom selector for desktop-owned resource settings. */
export function DefaultZoomSelect({
  value,
  onChange,
  disabled,
  ariaLabel = 'Default zoom',
}: DefaultZoomSelectProps) {
  return (
    <div className='w-[240px] flex-shrink-0'>
      <ChipSelect
        aria-label={ariaLabel}
        align='start'
        fullWidth
        dropdownWidth='trigger'
        value={String(value)}
        onChange={(next) => {
          const zoom = Number.parseInt(next, 10)
          if (isDesktopZoomPercent(zoom)) onChange(zoom)
        }}
        disabled={disabled}
        options={OPTIONS}
      />
    </div>
  )
}
