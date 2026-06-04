import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import { getVoiceSettingsContract } from '@/lib/api/contracts'

/**
 * Query key factory for voice settings queries
 */
export const voiceSettingsKeys = {
  all: ['voiceSettings'] as const,
  availability: () => [...voiceSettingsKeys.all, 'availability'] as const,
}

type VoiceSettingsResponse = ContractJsonResponse<typeof getVoiceSettingsContract>

async function fetchVoiceSettings(signal?: AbortSignal): Promise<VoiceSettingsResponse> {
  try {
    return await requestJson(getVoiceSettingsContract, { signal })
  } catch {
    return { sttAvailable: false }
  }
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
