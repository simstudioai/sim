import { confluenceCreateCommentTool } from '@/tools/confluence/create_comment'
import { confluenceCreatePageTool } from '@/tools/confluence/create_page'
import { confluenceDeleteAttachmentTool } from '@/tools/confluence/delete_attachment'
import { confluenceDeleteCommentTool } from '@/tools/confluence/delete_comment'
import { confluenceDeletePageTool } from '@/tools/confluence/delete_page'
import { confluenceGetSpaceTool } from '@/tools/confluence/get_space'
import { confluenceListAttachmentsTool } from '@/tools/confluence/list_attachments'
import { confluenceListCommentsTool } from '@/tools/confluence/list_comments'
import { confluenceListLabelsTool } from '@/tools/confluence/list_labels'
import { confluenceListSpacesTool } from '@/tools/confluence/list_spaces'
import { confluenceRetrieveTool } from '@/tools/confluence/retrieve'
import { confluenceSearchTool } from '@/tools/confluence/search'
import {
  ATTACHMENT_ITEM_PROPERTIES,
  ATTACHMENT_OUTPUT,
  ATTACHMENTS_OUTPUT,
  COMMENT_BODY_OUTPUT_PROPERTIES,
  COMMENT_ITEM_PROPERTIES,
  COMMENT_OUTPUT,
  COMMENTS_OUTPUT,
  DELETED_OUTPUT,
  LABEL_ITEM_PROPERTIES,
  LABEL_OUTPUT,
  LABELS_OUTPUT,
  PAGE_ID_OUTPUT,
  PAGE_ITEM_PROPERTIES,
  PAGE_OUTPUT,
  PAGES_OUTPUT,
  PAGINATION_LINKS_PROPERTIES,
  SEARCH_RESULT_ITEM_PROPERTIES,
  SEARCH_RESULT_OUTPUT,
  SEARCH_RESULT_SPACE_PROPERTIES,
  SEARCH_RESULTS_OUTPUT,
  SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
  SPACE_ITEM_PROPERTIES,
  SPACE_OUTPUT,
  SPACES_OUTPUT,
  SUCCESS_OUTPUT,
  TIMESTAMP_OUTPUT,
  URL_OUTPUT,
  VERSION_OUTPUT,
  VERSION_OUTPUT_PROPERTIES,
} from '@/tools/confluence/types'
import { confluenceUpdateTool } from '@/tools/confluence/update'
import { confluenceUpdateCommentTool } from '@/tools/confluence/update_comment'
import { confluenceUploadAttachmentTool } from '@/tools/confluence/upload_attachment'

export {
  // Tools
  confluenceRetrieveTool,
  confluenceUpdateTool,
  confluenceCreatePageTool,
  confluenceDeletePageTool,
  confluenceSearchTool,
  confluenceCreateCommentTool,
  confluenceListCommentsTool,
  confluenceUpdateCommentTool,
  confluenceDeleteCommentTool,
  confluenceListAttachmentsTool,
  confluenceDeleteAttachmentTool,
  confluenceUploadAttachmentTool,
  confluenceListLabelsTool,
  confluenceGetSpaceTool,
  confluenceListSpacesTool,
  // Item property constants (for use in outputs)
  ATTACHMENT_ITEM_PROPERTIES,
  COMMENT_ITEM_PROPERTIES,
  LABEL_ITEM_PROPERTIES,
  PAGE_ITEM_PROPERTIES,
  SEARCH_RESULT_ITEM_PROPERTIES,
  SPACE_ITEM_PROPERTIES,
  VERSION_OUTPUT_PROPERTIES,
  COMMENT_BODY_OUTPUT_PROPERTIES,
  SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
  SEARCH_RESULT_SPACE_PROPERTIES,
  PAGINATION_LINKS_PROPERTIES,
  // Complete output definitions (for use in outputs)
  ATTACHMENT_OUTPUT,
  ATTACHMENTS_OUTPUT,
  COMMENT_OUTPUT,
  COMMENTS_OUTPUT,
  LABEL_OUTPUT,
  LABELS_OUTPUT,
  PAGE_OUTPUT,
  PAGES_OUTPUT,
  SEARCH_RESULT_OUTPUT,
  SEARCH_RESULTS_OUTPUT,
  SPACE_OUTPUT,
  SPACES_OUTPUT,
  VERSION_OUTPUT,
  // Common output properties
  TIMESTAMP_OUTPUT,
  PAGE_ID_OUTPUT,
  SUCCESS_OUTPUT,
  DELETED_OUTPUT,
  URL_OUTPUT,
}
