import { fetchPointsTool } from '@/tools/qdrant/fetch_points'
import { searchVectorTool } from '@/tools/qdrant/search_vector'
import { upsertPointsTool } from '@/tools/qdrant/upsert_points'

export const qdrantUpsertTool = upsertPointsTool
export const qdrantSearchTool = searchVectorTool
export const qdrantFetchTool = fetchPointsTool
