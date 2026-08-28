import type { GuardrailsPiiValidateBody, GuardrailsPiiValidateResult } from '@/lib/api/contracts'
import {
  guardrailsPiiValidateBodySchema,
  guardrailsPiiValidateContract,
  guardrailsPiiValidateResponseSchema,
} from '@/lib/api/contracts'
import { generateInternalToken } from '@/lib/auth/internal'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { MAX_PII_VALIDATION_RESPONSE_BYTES } from '@/lib/guardrails/pii-limits'

/**
 * Validates one string through the app-container PII capability boundary.
 *
 * Workflow tool operations execute both in the app task and in Trigger.dev
 * workers, but only the app network can reach the ECS-internal Presidio
 * service. Always using this boundary keeps manual and scheduled verdicts on
 * one path and prevents the worker bundle from importing the Presidio client.
 */
export async function validatePIIViaHttp(
  input: GuardrailsPiiValidateBody,
  signal?: AbortSignal
): Promise<GuardrailsPiiValidateResult> {
  const body = guardrailsPiiValidateBodySchema.parse(input)
  const token = await generateInternalToken()
  const url = `${getInternalApiBaseUrl()}${guardrailsPiiValidateContract.path}`

  // boundary-raw-fetch: cross-process capability call to the authenticated app-container PII endpoint
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const detail = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'PII validation error response',
      signal,
    }).catch(() => '')
    throw new Error(`PII validation request failed (${response.status}): ${detail.slice(0, 200)}`)
  }

  const result = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_PII_VALIDATION_RESPONSE_BYTES,
    label: 'PII validation response',
    signal,
  })
  return guardrailsPiiValidateResponseSchema.parse(result)
}
