import { Globe, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class CrawlWebsiteClientTool extends BaseClientTool {
  static readonly id = 'crawl_website'

  constructor(toolCallId: string) {
    super(toolCallId, CrawlWebsiteClientTool.id, CrawlWebsiteClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Crawling website', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Crawling website', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Crawling website', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Crawled website', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to crawl website', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted crawling website', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped crawling website', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.url && typeof params.url === 'string') {
        const url = params.url

        switch (state) {
          case ClientToolCallState.success:
            return `Crawled ${url}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Crawling ${url}`
          case ClientToolCallState.error:
            return `Failed to crawl ${url}`
          case ClientToolCallState.aborted:
            return `Aborted crawling ${url}`
          case ClientToolCallState.rejected:
            return `Skipped crawling ${url}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
