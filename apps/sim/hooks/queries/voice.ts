import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getVoiceSettingsContract } from '@/lib/api/contracts'

/**
 * Query key factory for voice capability queries
 */
export const voiceSettingsKeys = {
  all: ['voiceSettings'] as const,
  settings: () => [...voiceSettingsKeys.all, 'settings'] as const,
}

/**
 * `/api/settings/voice` reports whether the server has an STT provider
 * configured, which is read from env at request time and so cannot change
 * within a session.
 */
export const VOICE_SETTINGS_STALE_TIME = Number.POSITIVE_INFINITY

async function fetchSttAvailable(signal?: AbortSignal): Promise<boolean> {
  const data = await requestJson(getVoiceSettingsContract, { signal })
  return data.sttAvailable === true
}

/**
 * Loads whether server-side speech-to-text is configured.
 *
 * `enabled` is caller-controlled so consumers gated on a browser capability
 * skip the request entirely on clients that could not use STT anyway.
 *
 * Deliberately no `initialData`: consumers derive their support flag from
 * `data === true`, so the first client render matches the server render
 * (unavailable) until the fetch resolves.
 */
export function useVoiceSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: voiceSettingsKeys.settings(),
    queryFn: ({ signal }) => fetchSttAvailable(signal),
    enabled: options?.enabled ?? true,
    staleTime: VOICE_SETTINGS_STALE_TIME,
  })
}
