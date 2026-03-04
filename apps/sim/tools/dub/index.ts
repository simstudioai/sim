import { createLinkTool } from '@/tools/dub/create_link'
import { deleteLinkTool } from '@/tools/dub/delete_link'
import { getAnalyticsTool } from '@/tools/dub/get_analytics'
import { getLinkTool } from '@/tools/dub/get_link'
import { listLinksTool } from '@/tools/dub/list_links'
import { updateLinkTool } from '@/tools/dub/update_link'
import { upsertLinkTool } from '@/tools/dub/upsert_link'

export const dubCreateLinkTool = createLinkTool
export const dubGetLinkTool = getLinkTool
export const dubUpdateLinkTool = updateLinkTool
export const dubUpsertLinkTool = upsertLinkTool
export const dubDeleteLinkTool = deleteLinkTool
export const dubListLinksTool = listLinksTool
export const dubGetAnalyticsTool = getAnalyticsTool
