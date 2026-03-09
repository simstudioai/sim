import { agentTool } from '@/tools/firecrawl/agent'
import { crawlTool } from '@/tools/firecrawl/crawl'
import { extractTool } from '@/tools/firecrawl/extract'
import { mapTool } from '@/tools/firecrawl/map'
import { scrapeTool } from '@/tools/firecrawl/scrape'
import { searchTool } from '@/tools/firecrawl/search'

export const firecrawlScrapeTool = scrapeTool
export const firecrawlSearchTool = searchTool
export const firecrawlCrawlTool = crawlTool
export const firecrawlMapTool = mapTool
export const firecrawlExtractTool = extractTool
export const firecrawlAgentTool = agentTool
