import { agentTool } from '@/tools/firecrawl/agent'
import { batchScrapeTool } from '@/tools/firecrawl/batch-scrape'
import { batchScrapeStatusTool } from '@/tools/firecrawl/batch-scrape-status'
import { cancelCrawlTool } from '@/tools/firecrawl/cancel-crawl'
import { crawlTool } from '@/tools/firecrawl/crawl'
import { crawlStatusTool } from '@/tools/firecrawl/crawl-status'
import { creditUsageTool } from '@/tools/firecrawl/credit-usage'
import { extractTool } from '@/tools/firecrawl/extract'
import { extractStatusTool } from '@/tools/firecrawl/extract-status'
import { mapTool } from '@/tools/firecrawl/map'
import { parseTool } from '@/tools/firecrawl/parse'
import { scrapeTool } from '@/tools/firecrawl/scrape'
import { searchTool } from '@/tools/firecrawl/search'

export const firecrawlScrapeTool = scrapeTool
export const firecrawlSearchTool = searchTool
export const firecrawlCrawlTool = crawlTool
export const firecrawlMapTool = mapTool
export const firecrawlExtractTool = extractTool
export const firecrawlAgentTool = agentTool
export const firecrawlParseTool = parseTool
export const firecrawlCrawlStatusTool = crawlStatusTool
export const firecrawlCancelCrawlTool = cancelCrawlTool
export const firecrawlBatchScrapeTool = batchScrapeTool
export const firecrawlBatchScrapeStatusTool = batchScrapeStatusTool
export const firecrawlExtractStatusTool = extractStatusTool
export const firecrawlCreditUsageTool = creditUsageTool
