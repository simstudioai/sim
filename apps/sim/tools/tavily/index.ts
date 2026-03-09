import { crawlTool } from '@/tools/tavily/crawl'
import { extractTool } from '@/tools/tavily/extract'
import { mapTool } from '@/tools/tavily/map'
import { searchTool } from '@/tools/tavily/search'

export const tavilyExtractTool = extractTool
export const tavilySearchTool = searchTool
export const tavilyCrawlTool = crawlTool
export const tavilyMapTool = mapTool
