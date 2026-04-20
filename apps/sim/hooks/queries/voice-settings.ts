import { useQuery } from '@tanstack/react-query'

/**
 * Query key factory for voice settings queries
 */
export const voiceSettingsKeys = {
  all: ['voiceSettings'] as const,
  availability: () => [...voiceSettingsKeys.all, 'availability'] as const,
}

interface VoiceSettingsResponse {
  sttAvailable: boolean
}

async function fetchVoiceSettings(signal?: AbortSignal): Promise<VoiceSettingsResponse> {
  const response = await fetch('/api/settings/voice', { signal })
  if (!response.ok) {
    return { sttAvailable: false }
  }
  return response.json()
}

/**
 * Loads the server-side voice configuration so clients can conditionally
 * enable voice input. Returns `{ sttAvailable: false }` on failure rather
 * than throwing, since STT is an optional capability.
 */
export function useVoiceSettings() {
  return useQuery({
    queryKey: voiceSettingsKeys.availability(),
    queryFn: ({ signal }) => fetchVoiceSettings(signal),
    staleTime: 5 * 60 * 1000,
  })
}
