import { chipFieldSurfaceClass, chipFieldTextClass, cn } from '@sim/emcn'

/** Pill wrapper. Override height/alignment (e.g. a textarea) via `cn`. */
export const CHIP_FIELD_SHELL = cn('flex h-[30px] items-center gap-1.5 px-2', chipFieldSurfaceClass)

/** Borderless input/textarea hosted inside {@link CHIP_FIELD_SHELL}. */
export const CHIP_FIELD_INPUT = cn('h-full w-full bg-transparent', chipFieldTextClass)
