import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

export const gongHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const callData = b.callData as Record<string, unknown> | undefined
    const metaData = (callData?.metaData as Record<string, unknown>) || {}
    const content = callData?.content as Record<string, unknown> | undefined

    return {
      input: {
        isTest: b.isTest ?? false,
        callData,
        metaData,
        parties: (callData?.parties as unknown[]) || [],
        context: (callData?.context as unknown[]) || [],
        trackers: (content?.trackers as unknown[]) || [],
      },
    }
  },
}
