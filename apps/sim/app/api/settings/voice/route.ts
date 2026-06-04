import { NextResponse } from 'next/server'
import { getVoiceSettingsContract } from '@/lib/api/contracts'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { hasSTTService } from '@/lib/speech/config'

const voiceSettingsResponseSchema = getVoiceSettingsContract.response.schema

/**
 * Returns whether server-side STT is configured.
 * Unauthenticated — the response is a single boolean,
 * not sensitive data, and deployed chat visitors need it.
 */
export const GET = withRouteHandler(async () => {
  return NextResponse.json(voiceSettingsResponseSchema.parse({ sttAvailable: hasSTTService() }))
})
