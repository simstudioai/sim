import { confluenceAddLabelTool } from '@/tools/confluence/add_label'
import { confluenceCreateBlogPostTool } from '@/tools/confluence/create_blogpost'
import { confluenceCreateCommentTool } from '@/tools/confluence/create_comment'
import { confluenceCreatePageTool } from '@/tools/confluence/create_page'
import { confluenceCreatePagePropertyTool } from '@/tools/confluence/create_page_property'
import { confluenceDeleteAttachmentTool } from '@/tools/confluence/delete_attachment'
import { confluenceDeleteCommentTool } from '@/tools/confluence/delete_comment'
import { confluenceDeletePageTool } from '@/tools/confluence/delete_page'
import { confluenceGetBlogPostTool } from '@/tools/confluence/get_blogpost'
import { confluenceGetPageAncestorsTool } from '@/tools/confluence/get_page_ancestors'
import { confluenceGetPageChildrenTool } from '@/tools/confluence/get_page_children'
import { confluenceGetPageVersionTool } from '@/tools/confluence/get_page_version'
import { confluenceGetSpaceTool } from '@/tools/confluence/get_space'
import { confluenceListAttachmentsTool } from '@/tools/confluence/list_attachments'
import { confluenceListBlogPostsTool } from '@/tools/confluence/list_blogposts'
import { confluenceListBlogPostsInSpaceTool } from '@/tools/confluence/list_blogposts_in_space'
import { confluenceListCommentsTool } from '@/tools/confluence/list_comments'
import { confluenceListLabelsTool } from '@/tools/confluence/list_labels'
import { confluenceListPagePropertiesTool } from '@/tools/confluence/list_page_properties'
import { confluenceListPageVersionsTool } from '@/tools/confluence/list_page_versions'
import { confluenceListPagesInSpaceTool } from '@/tools/confluence/list_pages_in_space'
import { confluenceListSpacesTool } from '@/tools/confluence/list_spaces'
import { confluenceRetrieveTool } from '@/tools/confluence/retrieve'
import { confluenceSearchTool } from '@/tools/confluence/search'
import { confluenceSearchInSpaceTool } from '@/tools/confluence/search_in_space'
import {
  ATTACHMENT_ITEM_PROPERTIES,
  ATTACHMENT_OUTPUT,
  ATTACHMENTS_OUTPUT,
  BODY_FORMAT_PROPERTIES,
  COMMENT_BODY_OUTPUT_PROPERTIES,
  COMMENT_ITEM_PROPERTIES,
  COMMENT_OUTPUT,
  COMMENTS_OUTPUT,
  CONTENT_BODY_OUTPUT,
  CONTENT_BODY_OUTPUT_PROPERTIES,
  DELETED_OUTPUT,
  DETAILED_VERSION_OUTPUT,
  DETAILED_VERSION_OUTPUT_PROPERTIES,
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
  // Page Tools
  confluenceRetrieveTool,
  confluenceUpdateTool,
  confluenceCreatePageTool,
  confluenceDeletePageTool,
  confluenceListPagesInSpaceTool,
  confluenceGetPageChildrenTool,
  confluenceGetPageAncestorsTool,
  // Page Version Tools
  confluenceListPageVersionsTool,
  confluenceGetPageVersionTool,
  // Page Properties Tools
  confluenceListPagePropertiesTool,
  confluenceCreatePagePropertyTool,
  // Blog Post Tools
  confluenceListBlogPostsTool,
  confluenceGetBlogPostTool,
  confluenceCreateBlogPostTool,
  confluenceListBlogPostsInSpaceTool,
  // Search Tools
  confluenceSearchTool,
  confluenceSearchInSpaceTool,
  // Comment Tools
  confluenceCreateCommentTool,
  confluenceListCommentsTool,
  confluenceUpdateCommentTool,
  confluenceDeleteCommentTool,
  // Attachment Tools
  confluenceListAttachmentsTool,
  confluenceDeleteAttachmentTool,
  confluenceUploadAttachmentTool,
  // Label Tools
  confluenceListLabelsTool,
  confluenceAddLabelTool,
  // Space Tools
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
  DETAILED_VERSION_OUTPUT_PROPERTIES,
  COMMENT_BODY_OUTPUT_PROPERTIES,
  CONTENT_BODY_OUTPUT_PROPERTIES,
  BODY_FORMAT_PROPERTIES,
  SPACE_DESCRIPTION_OUTPUT_PROPERTIES,
  SEARCH_RESULT_SPACE_PROPERTIES,
  PAGINATION_LINKS_PROPERTIES,
  // Complete output definitions (for use in outputs)
  ATTACHMENT_OUTPUT,
  ATTACHMENTS_OUTPUT,
  COMMENT_OUTPUT,
  COMMENTS_OUTPUT,
  CONTENT_BODY_OUTPUT,
  DETAILED_VERSION_OUTPUT,
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
