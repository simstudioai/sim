import { getAuthorPapersTool } from '@/tools/arxiv/get_author_papers'
import { getPaperTool } from '@/tools/arxiv/get_paper'
import { searchTool } from '@/tools/arxiv/search'

export const arxivSearchTool = searchTool
export const arxivGetPaperTool = getPaperTool
export const arxivGetAuthorPapersTool = getAuthorPapersTool
