/**
 * Jira Service Management Triggers
 * Export all JSM webhook triggers
 */

export { jsmAttachmentCreatedTrigger } from './attachment_created'
export { jsmAttachmentDeletedTrigger } from './attachment_deleted'
export { jsmCommentDeletedTrigger } from './comment_deleted'
export { jsmCommentUpdatedTrigger } from './comment_updated'
export { jsmRequestCommentedTrigger } from './request_commented'
export { jsmRequestCreatedTrigger } from './request_created'
export { jsmRequestDeletedTrigger } from './request_deleted'
export { jsmRequestUpdatedTrigger } from './request_updated'
export { jsmWebhookTrigger } from './webhook'
export { jsmWorklogCreatedTrigger } from './worklog_created'
export { jsmWorklogDeletedTrigger } from './worklog_deleted'
export { jsmWorklogUpdatedTrigger } from './worklog_updated'
