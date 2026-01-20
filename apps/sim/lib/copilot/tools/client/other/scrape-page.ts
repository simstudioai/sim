import { Globe, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class ScrapePageClientTool extends BaseClientTool {
  static readonly id = 'scrape_page'

  constructor(toolCallId: string) {
    super(toolCallId, ScrapePageClientTool.id, ScrapePageClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Scraping page', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Scraping page', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Scraping page', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Scraped page', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to scrape page', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted scraping page', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped scraping page', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.url && typeof params.url === 'string') {
        const url = params.url

        switch (state) {
          case ClientToolCallState.success:
            return `Scraped ${url}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Scraping ${url}`
          case ClientToolCallState.error:
            return `Failed to scrape ${url}`
          case ClientToolCallState.aborted:
            return `Aborted scraping ${url}`
          case ClientToolCallState.rejected:
            return `Skipped scraping ${url}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
