import { isPlainRecord } from '@sim/utils/object'
import { LIST_PRICE_POLICY, priceModelUsage } from '@/providers/cost-policy'
import { getChatCompletionConversationUsage } from '@/providers/openai-compat/conversation-usage'
import type { ModelPricing } from '@/providers/types'

/** Token counts a meter has accumulated; `input` excludes the cache hits counted in `cacheRead`. */
interface ChatCompletionMeteredTokens {
  input: number
  output: number
  cacheRead: number
  total: number
}

/** List-price cost of everything a meter has recorded, plus any tool cost passed in. */
interface ChatCompletionMeteredCost {
  input: number
  output: number
  total: number
  toolCost?: number
  pricing: ModelPricing
}

export interface ChatCompletionUsageMeter {
  /** Running totals; read a copy when handing them to a stream or response. */
  readonly tokens: ChatCompletionMeteredTokens
  /** Adds one model call's Chat Completions `usage` (ignored when absent or malformed). */
  record: (usage: unknown) => void
  cost: (toolCost?: number) => ChatCompletionMeteredCost
}

/**
 * Meters the model calls of one Chat Completions request.
 *
 * Providers report cache hits as a subset of `prompt_tokens`, so pricing the prompt total bills
 * them at the full input rate. Each call is split into its uncached remainder and cache read (see
 * {@link getChatCompletionConversationUsage}) and priced on its own, so cache hits bill at the
 * model's `cachedInput` rate and a long-context tier applies per call rather than to a summed
 * prompt. The cost is at list price: billability and the margin are applied once, centrally.
 */
export function createChatCompletionUsageMeter(model: string): ChatCompletionUsageMeter {
  const tokens: ChatCompletionMeteredTokens = { input: 0, output: 0, cacheRead: 0, total: 0 }
  let inputCost = 0
  let outputCost = 0

  return {
    tokens,
    record(usage) {
      const split = getChatCompletionConversationUsage(usage)
      if (!split || !isPlainRecord(usage)) return
      const cacheRead = split.cacheRead ?? 0
      tokens.input += split.input
      tokens.output += split.output
      tokens.cacheRead += cacheRead
      tokens.total +=
        typeof usage.total_tokens === 'number'
          ? usage.total_tokens
          : split.input + cacheRead + split.output
      const cost = priceModelUsage(model, split, LIST_PRICE_POLICY)
      inputCost += cost.input
      outputCost += cost.output
    },
    cost(toolCost = 0) {
      const input = Number.parseFloat(inputCost.toFixed(8))
      const output = Number.parseFloat(outputCost.toFixed(8))
      return {
        input,
        output,
        total: Number.parseFloat((input + output + toolCost).toFixed(8)),
        pricing: priceModelUsage(model, { input: 0, output: 0 }, LIST_PRICE_POLICY).pricing,
        ...(toolCost ? { toolCost } : {}),
      }
    },
  }
}
