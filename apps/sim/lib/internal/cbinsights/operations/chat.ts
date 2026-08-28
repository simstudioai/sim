import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { CbInsightsChatParams } from '@/tools/cbinsights/chat'
import {
  asArray,
  asString,
  asStringArray,
  cbInsightsRequest,
  compactBody,
} from '@/tools/cbinsights/utils'

export const executeCbinsightsChatOperation: InternalToolOperationImplementation<
  CbInsightsChatParams
> = async (params, signal) => {
  const message = params.message?.trim()
  if (!message) throw new Error('CB Insights "message" is required')

  return cbInsightsRequest<{
    chatID?: unknown
    title?: unknown
    message?: unknown
    sources?: unknown
    relatedContent?: unknown
    suggestions?: unknown
  }>(
    params,
    {
      path: '/v2/chatcbi',
      body: compactBody({ message, chatID: params.chatId?.trim() }),
    },
    (data) => ({
      chatId: asString(data.chatID),
      title: asString(data.title),
      message: asString(data.message),
      sources: asArray(data.sources),
      relatedContent: asArray(data.relatedContent),
      suggestions: asStringArray(data.suggestions),
    }),
    signal
  )
}
