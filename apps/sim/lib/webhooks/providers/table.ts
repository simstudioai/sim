import type { FormatInputContext, FormatInputResult, WebhookProviderHandler } from './types'

/**
 * Provider handler for table triggers.
 *
 * Tables use direct triggering (fired from the insert codepath),
 * so this handler only needs formatInput to pass the payload through.
 */
export const tableProviderHandler: WebhookProviderHandler = {
  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    return { input: body }
  },
}
