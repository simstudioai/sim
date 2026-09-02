import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

export const credentialGroupProviderHandler: WebhookProviderHandler = {
  executionMode: 'queue',
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },
}
