import { chipFilledFillTokens, chipRadiusClass } from '@sim/emcn'

/** Shared geometry and hover treatment for resource bulk-action buttons. */
export const RESOURCE_ACTION_BUTTON_BASE = `${chipRadiusClass} size-[28px] p-0 hover-hover:bg-[var(--brand-secondary)] hover-hover:text-[var(--text-inverse)]!`

/** Resource and knowledge actions follow the chip fill in both themes. */
export const RESOURCE_ACTION_BUTTON_FILLED = `${chipFilledFillTokens} ${RESOURCE_ACTION_BUTTON_BASE}`
