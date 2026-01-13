import { notionAddDatabaseRowTool } from '@/tools/notion/add_database_row'
import {
  notionCreateDatabaseTool,
  notionCreateDatabaseV2Tool,
} from '@/tools/notion/create_database'
import { notionCreatePageTool, notionCreatePageV2Tool } from '@/tools/notion/create_page'
import { notionQueryDatabaseTool, notionQueryDatabaseV2Tool } from '@/tools/notion/query_database'
import { notionReadTool, notionReadV2Tool } from '@/tools/notion/read'
import { notionReadDatabaseTool, notionReadDatabaseV2Tool } from '@/tools/notion/read_database'
import { notionSearchTool, notionSearchV2Tool } from '@/tools/notion/search'
import { notionUpdatePageTool, notionUpdatePageV2Tool } from '@/tools/notion/update_page'
import { notionWriteTool, notionWriteV2Tool } from '@/tools/notion/write'

export {
  // Legacy tools
  notionReadTool,
  notionReadDatabaseTool,
  notionWriteTool,
  notionCreatePageTool,
  notionUpdatePageTool,
  notionQueryDatabaseTool,
  notionSearchTool,
  notionCreateDatabaseTool,
  // V2 tools
  notionReadV2Tool,
  notionReadDatabaseV2Tool,
  notionWriteV2Tool,
  notionCreatePageV2Tool,
  notionUpdatePageV2Tool,
  notionQueryDatabaseV2Tool,
  notionSearchV2Tool,
  notionCreateDatabaseV2Tool,
  notionAddDatabaseRowTool,
}
