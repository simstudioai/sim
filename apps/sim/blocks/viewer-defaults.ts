import { getBrowserTimezone } from '@/lib/core/utils/timezone'

/**
 * Whether a sub-block's `value()` default resolves in the viewer's browser (the schedule
 * timezone is the person's own). Only the editor evaluates one. Server-side creation and the
 * source catalog leave the field unset instead of freezing the host's environment into it.
 */
export function isViewerDefault(thunk: unknown): boolean {
  return thunk === getBrowserTimezone
}
