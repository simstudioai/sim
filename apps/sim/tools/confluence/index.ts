// Page operations

// Label operations
import { confluenceAddLabelTool } from '@/tools/confluence/add_label'
// Comment operations
import { confluenceCreateCommentTool } from '@/tools/confluence/create_comment'
import { confluenceCreatePageTool } from '@/tools/confluence/create_page'
import { confluenceDeleteAttachmentTool } from '@/tools/confluence/delete_attachment'
import { confluenceDeleteCommentTool } from '@/tools/confluence/delete_comment'
import { confluenceDeletePageTool } from '@/tools/confluence/delete_page'
// Space operations
import { confluenceGetSpaceTool } from '@/tools/confluence/get_space'
// Attachment operations
import { confluenceListAttachmentsTool } from '@/tools/confluence/list_attachments'
import { confluenceListCommentsTool } from '@/tools/confluence/list_comments'
import { confluenceListLabelsTool } from '@/tools/confluence/list_labels'
import { confluenceListSpacesTool } from '@/tools/confluence/list_spaces'
import { confluenceRemoveLabelTool } from '@/tools/confluence/remove_label'
import { confluenceRetrieveTool } from '@/tools/confluence/retrieve'
// Search operations
import { confluenceSearchTool } from '@/tools/confluence/search'
import { confluenceUpdateTool } from '@/tools/confluence/update'
import { confluenceUpdateCommentTool } from '@/tools/confluence/update_comment'

// Page operations exports
export { confluenceRetrieveTool }
export { confluenceUpdateTool }
export { confluenceCreatePageTool }
export { confluenceDeletePageTool }

// Search operations exports
export { confluenceSearchTool }

// Comment operations exports
export { confluenceCreateCommentTool }
export { confluenceListCommentsTool }
export { confluenceUpdateCommentTool }
export { confluenceDeleteCommentTool }

// Attachment operations exports
export { confluenceListAttachmentsTool }
export { confluenceDeleteAttachmentTool }

// Label operations exports
export { confluenceAddLabelTool }
export { confluenceListLabelsTool }
export { confluenceRemoveLabelTool }

// Space operations exports
export { confluenceGetSpaceTool }
export { confluenceListSpacesTool }
