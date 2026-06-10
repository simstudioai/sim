/**
 * Shared chip-field chrome for the credential and secret detail surfaces.
 *
 * These mirror {@link ChipInput} exactly (30px tall,
 * `rounded-lg`, `border-1`, `surface-5`/`surface-4`, normal-weight body text,
 * and no focus ring) but as a wrapper + inner-input pair, so a field can host a
 * borderless input alongside a trailing slot (a copy button, a reveal toggle).
 * Using one definition keeps every chip field — list rows,
 * copyable IDs, secret values, display-name/description editors — pixel-identical
 * to the canonical chip input instead of each re-deriving the tokens.
 */

import { chipFieldSurfaceClass, chipFieldTextClass } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

/** Pill wrapper. Override height/alignment (e.g. a textarea) via `cn`. */
export const CHIP_FIELD_SHELL = cn('flex h-[30px] items-center gap-1.5 px-2', chipFieldSurfaceClass)

/** Borderless input/textarea hosted inside {@link CHIP_FIELD_SHELL}. */
export const CHIP_FIELD_INPUT = cn('h-full w-full bg-transparent', chipFieldTextClass)
