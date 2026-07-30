import { bulkCreateLinksTool } from '@/tools/dub/bulk_create_links'
import { bulkDeleteLinksTool } from '@/tools/dub/bulk_delete_links'
import { bulkUpdateLinksTool } from '@/tools/dub/bulk_update_links'
import { createLinkTool } from '@/tools/dub/create_link'
import { createTagTool } from '@/tools/dub/create_tag'
import { deleteLinkTool } from '@/tools/dub/delete_link'
import { getAnalyticsTool } from '@/tools/dub/get_analytics'
import { getEventsTool } from '@/tools/dub/get_events'
import { getLinkTool } from '@/tools/dub/get_link'
import { getLinksCountTool } from '@/tools/dub/get_links_count'
import { getQrCodeTool } from '@/tools/dub/get_qr_code'
import { listDomainsTool } from '@/tools/dub/list_domains'
import { listFoldersTool } from '@/tools/dub/list_folders'
import { listLinksTool } from '@/tools/dub/list_links'
import { listTagsTool } from '@/tools/dub/list_tags'
import { updateLinkTool } from '@/tools/dub/update_link'
import { upsertLinkTool } from '@/tools/dub/upsert_link'

export const dubCreateLinkTool = createLinkTool
export const dubGetLinkTool = getLinkTool
export const dubUpdateLinkTool = updateLinkTool
export const dubUpsertLinkTool = upsertLinkTool
export const dubDeleteLinkTool = deleteLinkTool
export const dubListLinksTool = listLinksTool
export const dubGetAnalyticsTool = getAnalyticsTool
export const dubGetLinksCountTool = getLinksCountTool
export const dubGetEventsTool = getEventsTool
export const dubBulkCreateLinksTool = bulkCreateLinksTool
export const dubBulkUpdateLinksTool = bulkUpdateLinksTool
export const dubBulkDeleteLinksTool = bulkDeleteLinksTool
export const dubGetQrCodeTool = getQrCodeTool
export const dubListDomainsTool = listDomainsTool
export const dubListTagsTool = listTagsTool
export const dubCreateTagTool = createTagTool
export const dubListFoldersTool = listFoldersTool
