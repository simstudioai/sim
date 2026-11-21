import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { openAICompatibleModelListSchema } from '@/lib/api/contracts/providers'
import { getOpenAICompatibleApiBaseUrl } from '@/providers/openai-compat/base-url'

const logger = createLogger('OpenAICompatibleModelList')

interface ListOpenAICompatibleModelsOptions {
  /** Server root or `/v1` API base; normalized by {@link getOpenAICompatibleApiBaseUrl}. */
  baseUrl: string
  apiKey?: string
  /** Namespace prepended to each served model id, e.g. `vllm/`. */
  prefix: string
  /** Extra fetch options, such as Next's `next.revalidate`. */
  init?: RequestInit
}

/**
 * Lists the models an operator-configured OpenAI-compatible server serves, as
 * namespaced Sim model ids. Kept free of the executor graph so API routes can use it.
 *
 * @returns The model ids, or `null` when the server answers with a non-2xx status.
 * @throws When the base URL is unsupported, the request fails, or the body is malformed.
 */
export async function listOpenAICompatibleModels({
  baseUrl,
  apiKey,
  prefix,
  init,
}: ListOpenAICompatibleModelsOptions): Promise<string[] | null> {
  const apiBaseUrl = getOpenAICompatibleApiBaseUrl(baseUrl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  // egress-direct: operator's own model server named by the deployment
  const response = await fetch(`${apiBaseUrl}/models`, { ...init, headers })
  if (!response.ok) {
    await response.text().catch(() => {})
    logger.warn('OpenAI-compatible model list request failed', {
      prefix,
      status: response.status,
      statusText: response.statusText,
    })
    return null
  }

  const data = openAICompatibleModelListSchema.parse(await response.json())
  return data.data.map((model) => `${prefix}${model.id}`)
}

/**
 * Lists the models served by the deployment's own vLLM or LiteLLM server, given
 * its configured base URL and key. Never throws: an unset base URL, an unsupported
 * URL, a non-2xx answer, or an unreachable server all read as no models. Provider
 * and model blacklists are the caller's to apply, which keeps this module free of
 * `@/providers/utils` and the provider graph behind it.
 */
export async function listConfiguredSelfHostedModels(
  providerId: 'vllm' | 'litellm',
  baseUrl: string | undefined,
  apiKey: string | undefined
): Promise<string[]> {
  const trimmedBaseUrl = baseUrl?.trim()
  if (!trimmedBaseUrl) return []

  try {
    const models = await listOpenAICompatibleModels({
      baseUrl: trimmedBaseUrl,
      apiKey,
      prefix: `${providerId}/`,
      init: { next: { revalidate: 60 } },
    })
    return models ?? []
  } catch (error) {
    logger.error('Failed to list self-hosted provider models', {
      providerId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return []
  }
}
