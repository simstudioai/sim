import { sanitizeTimezoneForDisplay } from '@/lib/core/utils/timezone'
import type { TimezoneState } from '@/hooks/queries/general-settings'

export function getTimezoneEditBlockedMessage(state: TimezoneState): string | null {
  if (state.status === 'ready') return null
  if (state.status === 'loading') {
    return 'Your timezone setting is still loading. Try again in a moment.'
  }
  if (state.status === 'error') {
    return 'We couldn’t load your timezone setting. Try again before editing Date or Expiration cells.'
  }
  const savedTimezone = sanitizeTimezoneForDisplay(state.savedTimezone ?? '')
  return `Your saved timezone “${savedTimezone}” is invalid. Update it in Settings → General before editing Date or Expiration cells.`
}
