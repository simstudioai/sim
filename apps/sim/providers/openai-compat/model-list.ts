import { createLogger } from '@sim/logger'
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
