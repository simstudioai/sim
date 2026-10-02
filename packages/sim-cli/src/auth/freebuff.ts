import type { AuthRequest } from '#sim-cli/auth/device-flow'
import { buildUrl } from '#sim-cli/http/client'
import { writeStderr } from '#sim-cli/output/io'

/** Proposed partner carrier; activate in sponsored procedures only after Freebuff review. */
export async function prepareFreebuffHandoff(
  endpoint: string,
  auth: AuthRequest,
  approvalUrl: string
): Promise<string> {
  const token = process.env.SIM_FREEBUFF_CONVERSION_TOKEN
  Reflect.deleteProperty(process.env, 'SIM_FREEBUFF_CONVERSION_TOKEN')
  if (!token) return approvalUrl
  const origin = new URL(endpoint)
  if (
    origin.origin !== 'https://www.sim.ai' ||
    token.length > 600 ||
    /[\x00-\x20\x7f]/.test(token)
  ) {
    writeStderr('Sponsored attribution unavailable; continuing ordinary sign-in.\n')
    return approvalUrl
  }
  try {
    const response = await fetch(buildUrl(endpoint, '/api/attribution/freebuff/handoff'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: auth.request,
        challenge: auth.challenge,
        conversionToken: token,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    await response.body?.cancel()
    if (response.status !== 204) throw new Error('Attribution unavailable')
    const browserUrl = new URL(buildUrl(endpoint, '/api/attribution/freebuff'))
    browserUrl.search = new URL(approvalUrl).search
    return browserUrl.toString()
  } catch {
    writeStderr('Sponsored attribution unavailable; continuing ordinary sign-in.\n')
    return approvalUrl
  }
}
