// Elasticsearch tools exports
import { bulkTool } from '@/tools/elasticsearch/bulk'
import { clusterHealthTool } from '@/tools/elasticsearch/cluster_health'
import { clusterStatsTool } from '@/tools/elasticsearch/cluster_stats'
import { countTool } from '@/tools/elasticsearch/count'
import { createIndexTool } from '@/tools/elasticsearch/create_index'
import { deleteDocumentTool } from '@/tools/elasticsearch/delete_document'
import { deleteIndexTool } from '@/tools/elasticsearch/delete_index'
import { getDocumentTool } from '@/tools/elasticsearch/get_document'
import { getIndexTool } from '@/tools/elasticsearch/get_index'
import { indexDocumentTool } from '@/tools/elasticsearch/index_document'
import { listIndicesTool } from '@/tools/elasticsearch/list_indices'
import { searchTool } from '@/tools/elasticsearch/search'
import { updateDocumentTool } from '@/tools/elasticsearch/update_document'

// Export individual tools with elasticsearch prefix
export const elasticsearchSearchTool = searchTool
export const elasticsearchIndexDocumentTool = indexDocumentTool
export const elasticsearchGetDocumentTool = getDocumentTool
export const elasticsearchUpdateDocumentTool = updateDocumentTool
export const elasticsearchDeleteDocumentTool = deleteDocumentTool
export const elasticsearchBulkTool = bulkTool
export const elasticsearchCountTool = countTool
export const elasticsearchCreateIndexTool = createIndexTool
export const elasticsearchDeleteIndexTool = deleteIndexTool
export const elasticsearchGetIndexTool = getIndexTool
export const elasticsearchListIndicesTool = listIndicesTool
export const elasticsearchClusterHealthTool = clusterHealthTool
export const elasticsearchClusterStatsTool = clusterStatsTool
