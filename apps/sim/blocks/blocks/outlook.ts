import { OutlookIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { OutlookResponse } from '@/tools/outlook/types'
import { getTrigger } from '@/triggers'

export const OutlookBlock: BlockConfig<OutlookResponse> = {
  type: 'outlook',
  name: 'Outlook',
  description: 'Send, read, search, reply, organize, and manage Outlook email and calendar',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Outlook into the workflow. Can send, draft, read, search, reply, forward, move, copy, and delete email; manage mail folders and attachments; and set categories and flags on messages. Can also list, create, update, delete, and respond to calendar events and suggest meeting times. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/integrations/outlook',
  category: 'tools',
  integrationType: IntegrationType.Email,
  triggerAllowed: true,
  bgColor: '#FFFFFF',
  icon: OutlookIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_outlook' },
        { label: 'Draft Email', id: 'draft_outlook' },
        { label: 'Read Email', id: 'read_outlook' },
        { label: 'Search Email', id: 'search_outlook' },
        { label: 'Reply to Email', id: 'reply_outlook' },
        { label: 'Reply All', id: 'reply_all_outlook' },
        { label: 'Forward Email', id: 'forward_outlook' },
        { label: 'Move Email', id: 'move_outlook' },
        { label: 'Copy Email', id: 'copy_outlook' },
        { label: 'Mark as Read', id: 'mark_read_outlook' },
        { label: 'Mark as Unread', id: 'mark_unread_outlook' },
        { label: 'Set Categories & Flag', id: 'update_message_outlook' },
        { label: 'Delete Email', id: 'delete_outlook' },
        { label: 'List Folders', id: 'list_folders_outlook' },
        { label: 'Create Folder', id: 'create_folder_outlook' },
        { label: 'List Attachments', id: 'list_attachments_outlook' },
        { label: 'Get Attachment', id: 'get_attachment_outlook' },
        { label: 'List Calendar Events', id: 'list_events_calendar' },
        { label: 'Get Calendar Event', id: 'get_event_calendar' },
        { label: 'Create Event', id: 'create_event_calendar' },
        { label: 'Update Event', id: 'update_event_calendar' },
        { label: 'Delete Event', id: 'delete_event_calendar' },
        { label: 'Respond to Invite', id: 'respond_calendar' },
      ],
      value: () => 'send_outlook',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'outlook',
      requiredScopes: getScopesForService('outlook'),
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'Recipient email address',
      condition: {
        field: 'operation',
        value: ['send_outlook', 'draft_outlook', 'forward_outlook'],
      },
      required: true,
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Message ID to forward',
      condition: { field: 'operation', value: ['forward_outlook'] },
      required: true,
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Message to include when forwarding or replying',
      condition: {
        field: 'operation',
        value: ['forward_outlook', 'reply_outlook', 'reply_all_outlook'],
      },
      required: false,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      required: true,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text' },
        { label: 'HTML', id: 'html' },
      ],
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      value: () => 'text',
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'attachments',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'attachmentReference',
      title: 'Attachments',
      type: 'short-input',
      canonicalParamId: 'attachments',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Threading
    {
      id: 'replyToMessageId',
      title: 'Reply to Message ID',
      type: 'short-input',
      placeholder: 'Message ID to reply to (for threading)',
      condition: { field: 'operation', value: ['send_outlook'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Additional Recipients
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'CC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'BCC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    // Read Email Fields - Add folder selector (basic mode)
    {
      id: 'folderSelector',
      title: 'Folder',
      type: 'folder-selector',
      canonicalParamId: 'folder',
      serviceId: 'outlook',
      selectorKey: 'outlook.folders',
      requiredScopes: getScopesForService('outlook'),
      placeholder: 'Select Outlook folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    // Manual folder input (advanced mode)
    {
      id: 'manualFolder',
      title: 'Folder',
      type: 'short-input',
      canonicalParamId: 'folder',
      placeholder: 'Enter Outlook folder name (e.g., INBOX, SENT, or custom folder)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    {
      id: 'maxResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: 'Number of results to retrieve',
      condition: {
        field: 'operation',
        value: ['read_outlook', 'search_outlook', 'list_folders_outlook'],
      },
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    // Move Email Fields
    {
      id: 'moveMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email to move',
      condition: { field: 'operation', value: 'move_outlook' },
      required: true,
    },
    // Destination folder selector (basic mode)
    {
      id: 'destinationFolder',
      title: 'Move To Folder',
      type: 'folder-selector',
      canonicalParamId: 'destinationId',
      serviceId: 'outlook',
      selectorKey: 'outlook.folders',
      requiredScopes: getScopesForService('outlook'),
      placeholder: 'Select destination folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'move_outlook' },
      required: true,
    },
    // Manual destination folder input (advanced mode)
    {
      id: 'manualDestinationFolder',
      title: 'Move To Folder',
      type: 'short-input',
      canonicalParamId: 'destinationId',
      placeholder: 'Enter folder ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'move_outlook' },
      required: true,
    },
    // Single-message operations - Message ID field
    {
      id: 'actionMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email',
      condition: {
        field: 'operation',
        value: [
          'mark_read_outlook',
          'mark_unread_outlook',
          'delete_outlook',
          'reply_outlook',
          'reply_all_outlook',
          'update_message_outlook',
          'list_attachments_outlook',
          'get_attachment_outlook',
        ],
      },
      required: true,
    },
    // Copy Email - Message ID field
    {
      id: 'copyMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email to copy',
      condition: { field: 'operation', value: 'copy_outlook' },
      required: true,
    },
    // Copy Email - Destination folder selector (basic mode)
    {
      id: 'copyDestinationFolder',
      title: 'Copy To Folder',
      type: 'folder-selector',
      canonicalParamId: 'copyDestinationId',
      serviceId: 'outlook',
      selectorKey: 'outlook.folders',
      requiredScopes: getScopesForService('outlook'),
      placeholder: 'Select destination folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'copy_outlook' },
      required: true,
    },
    // Copy Email - Manual destination folder input (advanced mode)
    {
      id: 'manualCopyDestinationFolder',
      title: 'Copy To Folder',
      type: 'short-input',
      canonicalParamId: 'copyDestinationId',
      placeholder: 'Enter folder ID',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy_outlook' },
      required: true,
    },
    // Search Email - Query field
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Text to search across subject, body, sender, and recipients',
      condition: { field: 'operation', value: 'search_outlook' },
      required: true,
    },
    // List Folders - Include hidden folders toggle
    {
      id: 'includeHiddenFolders',
      title: 'Include Hidden Folders',
      type: 'switch',
      condition: { field: 'operation', value: 'list_folders_outlook' },
      mode: 'advanced',
    },
    // Create Folder - Folder name field
    {
      id: 'folderName',
      title: 'Folder Name',
      type: 'short-input',
      placeholder: 'Name of the new folder',
      condition: { field: 'operation', value: 'create_folder_outlook' },
      required: true,
    },
    // Create Folder - Hidden toggle
    {
      id: 'folderIsHidden',
      title: 'Hidden Folder',
      type: 'switch',
      condition: { field: 'operation', value: 'create_folder_outlook' },
      mode: 'advanced',
    },
    // Get Attachment - Attachment ID field
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'ID of the attachment to retrieve',
      condition: { field: 'operation', value: 'get_attachment_outlook' },
      required: true,
    },
    // Set Categories & Flag - Categories field
    {
      id: 'categories',
      title: 'Categories',
      type: 'short-input',
      placeholder: 'Comma-separated category names (replaces existing categories)',
      condition: { field: 'operation', value: 'update_message_outlook' },
      required: false,
    },
    // Set Categories & Flag - Flag status
    {
      id: 'flagStatus',
      title: 'Flag Status',
      type: 'dropdown',
      options: [
        { label: 'Not Flagged', id: 'notFlagged' },
        { label: 'Flagged', id: 'flagged' },
        { label: 'Complete', id: 'complete' },
      ],
      condition: { field: 'operation', value: 'update_message_outlook' },
      required: false,
    },
    // Set Categories & Flag - Importance
    {
      id: 'importance',
      title: 'Importance',
      type: 'dropdown',
      options: [
        { label: 'Low', id: 'low' },
        { label: 'Normal', id: 'normal' },
        { label: 'High', id: 'high' },
      ],
      condition: { field: 'operation', value: 'update_message_outlook' },
      mode: 'advanced',
      required: false,
    },
    // Calendar - Event ID (get / update / delete / respond)
    {
      id: 'calEventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'ID of the calendar event',
      condition: {
        field: 'operation',
        value: [
          'get_event_calendar',
          'update_event_calendar',
          'delete_event_calendar',
          'respond_calendar',
        ],
      },
      required: true,
    },
    // Calendar - Window start/end (list events). Required: calendarView needs both bounds.
    {
      id: 'calWindowStart',
      title: 'Start of Window',
      type: 'short-input',
      placeholder: '2025-06-03T00:00:00-08:00',
      condition: { field: 'operation', value: 'list_events_calendar' },
      required: true,
    },
    {
      id: 'calWindowEnd',
      title: 'End of Window',
      type: 'short-input',
      placeholder: '2025-06-10T00:00:00-08:00',
      condition: { field: 'operation', value: 'list_events_calendar' },
      required: true,
    },
    // Calendar - List events options
    {
      id: 'calMaxResults',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: 'Number of events to retrieve (default: 10, max: 100)',
      condition: { field: 'operation', value: 'list_events_calendar' },
    },
    {
      id: 'calOrderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'start/dateTime',
      condition: { field: 'operation', value: 'list_events_calendar' },
      mode: 'advanced',
    },
    {
      id: 'calPageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'nextLink URL from a previous response',
      condition: { field: 'operation', value: 'list_events_calendar' },
      mode: 'advanced',
    },
    // Calendar - Create event (required start/end)
    {
      id: 'calSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Event title',
      condition: { field: 'operation', value: 'create_event_calendar' },
      required: true,
    },
    {
      id: 'calStartDateTime',
      title: 'Start Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T10:00:00-08:00',
      condition: { field: 'operation', value: 'create_event_calendar' },
      required: true,
    },
    {
      id: 'calEndDateTime',
      title: 'End Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'create_event_calendar' },
      required: true,
    },
    // Calendar - Update event (optional start/end/subject)
    {
      id: 'calSubject',
      title: 'New Subject',
      type: 'short-input',
      placeholder: 'Updated event title',
      condition: { field: 'operation', value: 'update_event_calendar' },
      required: false,
    },
    {
      id: 'calStartDateTime',
      title: 'New Start Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T10:00:00-08:00',
      condition: { field: 'operation', value: 'update_event_calendar' },
      required: false,
    },
    {
      id: 'calEndDateTime',
      title: 'New End Date & Time',
      type: 'short-input',
      placeholder: '2025-06-03T11:00:00-08:00',
      condition: { field: 'operation', value: 'update_event_calendar' },
      required: false,
    },
    // Calendar - Shared create/update fields
    {
      id: 'calBody',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Event description',
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      required: false,
    },
    {
      id: 'calContentType',
      title: 'Body Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text' },
        { label: 'HTML', id: 'html' },
      ],
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      value: () => 'text',
      mode: 'advanced',
      required: false,
    },
    {
      id: 'calLocation',
      title: 'Location',
      type: 'short-input',
      placeholder: 'Event location',
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      required: false,
    },
    // Calendar - Attendees (create / update)
    {
      id: 'calAttendees',
      title: 'Attendees',
      type: 'short-input',
      placeholder: 'Attendee emails (comma-separated)',
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      required: false,
    },
    {
      id: 'calTimeZone',
      title: 'Time Zone',
      type: 'short-input',
      placeholder: 'America/Los_Angeles',
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'calIsAllDay',
      title: 'All Day',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      mode: 'advanced',
    },
    {
      id: 'calIsOnlineMeeting',
      title: 'Add Online Meeting',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['create_event_calendar', 'update_event_calendar'],
      },
      mode: 'advanced',
    },
    // Calendar - Respond to invite
    {
      id: 'calResponseType',
      title: 'Response',
      type: 'dropdown',
      options: [
        { label: 'Accept', id: 'accept' },
        { label: 'Tentative', id: 'tentativelyAccept' },
        { label: 'Decline', id: 'decline' },
      ],
      condition: { field: 'operation', value: 'respond_calendar' },
      value: () => 'accept',
      required: true,
    },
    {
      id: 'calComment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Optional message to the organizer',
      condition: { field: 'operation', value: 'respond_calendar' },
      required: false,
    },
    {
      id: 'calSendResponse',
      title: 'Send Response to Organizer',
      type: 'switch',
      condition: { field: 'operation', value: 'respond_calendar' },
      mode: 'advanced',
    },
    ...getTrigger('outlook_poller').subBlocks,
  ],
  tools: {
    access: [
      'outlook_send',
      'outlook_draft',
      'outlook_read',
      'outlook_search',
      'outlook_reply',
      'outlook_reply_all',
      'outlook_forward',
      'outlook_move',
      'outlook_copy',
      'outlook_mark_read',
      'outlook_mark_unread',
      'outlook_update_message',
      'outlook_delete',
      'outlook_list_folders',
      'outlook_create_folder',
      'outlook_list_attachments',
      'outlook_get_attachment',
      'outlook_calendar_list_events',
      'outlook_calendar_get_event',
      'outlook_calendar_create_event',
      'outlook_calendar_update_event',
      'outlook_calendar_delete_event',
      'outlook_calendar_respond',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_outlook':
            return 'outlook_send'
          case 'read_outlook':
            return 'outlook_read'
          case 'draft_outlook':
            return 'outlook_draft'
          case 'forward_outlook':
            return 'outlook_forward'
          case 'move_outlook':
            return 'outlook_move'
          case 'mark_read_outlook':
            return 'outlook_mark_read'
          case 'mark_unread_outlook':
            return 'outlook_mark_unread'
          case 'delete_outlook':
            return 'outlook_delete'
          case 'copy_outlook':
            return 'outlook_copy'
          case 'search_outlook':
            return 'outlook_search'
          case 'reply_outlook':
            return 'outlook_reply'
          case 'reply_all_outlook':
            return 'outlook_reply_all'
          case 'update_message_outlook':
            return 'outlook_update_message'
          case 'list_folders_outlook':
            return 'outlook_list_folders'
          case 'create_folder_outlook':
            return 'outlook_create_folder'
          case 'list_attachments_outlook':
            return 'outlook_list_attachments'
          case 'get_attachment_outlook':
            return 'outlook_get_attachment'
          case 'list_events_calendar':
            return 'outlook_calendar_list_events'
          case 'get_event_calendar':
            return 'outlook_calendar_get_event'
          case 'create_event_calendar':
            return 'outlook_calendar_create_event'
          case 'update_event_calendar':
            return 'outlook_calendar_update_event'
          case 'delete_event_calendar':
            return 'outlook_calendar_delete_event'
          case 'respond_calendar':
            return 'outlook_calendar_respond'
          default:
            throw new Error(`Invalid Outlook operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          oauthCredential,
          folder,
          destinationId,
          copyDestinationId,
          attachments,
          moveMessageId,
          actionMessageId,
          copyMessageId,
          searchQuery,
          folderName,
          folderIsHidden,
          includeHiddenFolders,
          categories,
          maxResults,
          calEventId,
          calWindowStart,
          calWindowEnd,
          calMaxResults,
          calOrderBy,
          calPageToken,
          calSubject,
          calStartDateTime,
          calEndDateTime,
          calBody,
          calContentType,
          calLocation,
          calAttendees,
          calTimeZone,
          calIsAllDay,
          calIsOnlineMeeting,
          calResponseType,
          calComment,
          calSendResponse,
          ...rest
        } = params

        // Agent calls may deliver booleans as the strings "true"/"false"
        const toBool = (value: unknown): boolean => value === true || value === 'true'

        // folder is already the canonical param - use it directly
        const effectiveFolder = folder ? String(folder).trim() : ''

        // Normalize file attachments from the canonical attachments param
        const normalizedAttachments = normalizeFileInput(attachments)
        if (normalizedAttachments) {
          rest.attachments = normalizedAttachments
        }

        if (maxResults != null && maxResults !== '') {
          rest.maxResults = Number(maxResults)
        }

        if (rest.operation === 'read_outlook') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        if (rest.operation === 'search_outlook' && searchQuery) {
          rest.query = String(searchQuery).trim()
        }

        if (rest.operation === 'list_folders_outlook') {
          rest.includeHiddenFolders = toBool(includeHiddenFolders)
        }

        if (rest.operation === 'create_folder_outlook') {
          if (folderName) {
            rest.displayName = String(folderName).trim()
          }
          rest.isHidden = toBool(folderIsHidden)
        }

        // Handle move operation
        if (rest.operation === 'move_outlook') {
          if (moveMessageId) {
            rest.messageId = moveMessageId
          }
          // destinationId is already the canonical param
          const effectiveDestinationId = destinationId ? String(destinationId).trim() : ''
          if (effectiveDestinationId) {
            rest.destinationId = effectiveDestinationId
          }
        }

        if (
          [
            'mark_read_outlook',
            'mark_unread_outlook',
            'delete_outlook',
            'reply_outlook',
            'reply_all_outlook',
            'update_message_outlook',
            'list_attachments_outlook',
            'get_attachment_outlook',
          ].includes(rest.operation)
        ) {
          if (actionMessageId) {
            rest.messageId = actionMessageId
          }
        }

        if (
          rest.operation === 'update_message_outlook' &&
          categories != null &&
          categories !== ''
        ) {
          rest.categories = categories
        }

        if (rest.operation === 'copy_outlook') {
          if (copyMessageId) {
            rest.messageId = copyMessageId
          }
          // copyDestinationId is the canonical param - map it to destinationId for the tool
          const effectiveCopyDestinationId = copyDestinationId
            ? String(copyDestinationId).trim()
            : ''
          if (effectiveCopyDestinationId) {
            rest.destinationId = effectiveCopyDestinationId
          }
        }

        const isSet = (value: unknown): boolean =>
          value !== undefined && value !== null && value !== ''

        if (rest.operation === 'list_events_calendar') {
          if (calWindowStart) rest.startDateTime = String(calWindowStart).trim()
          if (calWindowEnd) rest.endDateTime = String(calWindowEnd).trim()
          if (isSet(calMaxResults)) rest.maxResults = Number(calMaxResults)
          if (calOrderBy) rest.orderBy = String(calOrderBy).trim()
          if (calPageToken) rest.pageToken = String(calPageToken).trim()
        }

        if (
          [
            'get_event_calendar',
            'update_event_calendar',
            'delete_event_calendar',
            'respond_calendar',
          ].includes(rest.operation)
        ) {
          if (calEventId) rest.eventId = String(calEventId).trim()
        }

        if (rest.operation === 'create_event_calendar') {
          if (calSubject) rest.subject = calSubject
          if (calStartDateTime) rest.startDateTime = String(calStartDateTime).trim()
          if (calEndDateTime) rest.endDateTime = String(calEndDateTime).trim()
          if (isSet(calBody)) rest.body = calBody
          if (calContentType) rest.contentType = calContentType
          if (isSet(calLocation)) rest.location = calLocation
          if (isSet(calAttendees)) rest.attendees = calAttendees
          if (calTimeZone) rest.timeZone = String(calTimeZone).trim()
          rest.isAllDay = toBool(calIsAllDay)
          rest.isOnlineMeeting = toBool(calIsOnlineMeeting)
        }

        if (rest.operation === 'update_event_calendar') {
          if (isSet(calSubject)) rest.subject = calSubject
          if (calStartDateTime) rest.startDateTime = String(calStartDateTime).trim()
          if (calEndDateTime) rest.endDateTime = String(calEndDateTime).trim()
          if (isSet(calBody)) rest.body = calBody
          if (calContentType) rest.contentType = calContentType
          if (isSet(calLocation)) rest.location = calLocation
          if (isSet(calAttendees)) rest.attendees = calAttendees
          if (calTimeZone) rest.timeZone = String(calTimeZone).trim()
          if (isSet(calIsAllDay)) rest.isAllDay = toBool(calIsAllDay)
          if (isSet(calIsOnlineMeeting)) rest.isOnlineMeeting = toBool(calIsOnlineMeeting)
        }

        if (rest.operation === 'respond_calendar') {
          if (calResponseType) rest.responseType = calResponseType
          if (isSet(calComment)) rest.comment = calComment
          if (isSet(calSendResponse)) rest.sendResponse = toBool(calSendResponse)
        }

        return {
          ...rest,
          oauthCredential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Outlook access token' },
    // Send operation inputs
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email content' },
    contentType: { type: 'string', description: 'Content type (Text or HTML)' },
    attachments: { type: 'array', description: 'Files to attach (canonical param)' },
    // Forward operation inputs
    messageId: { type: 'string', description: 'Message ID to forward' },
    comment: { type: 'string', description: 'Optional comment for forwarding' },
    // Read operation inputs
    folder: { type: 'string', description: 'Email folder (canonical param)' },
    maxResults: { type: 'number', description: 'Maximum emails' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Move operation inputs
    moveMessageId: { type: 'string', description: 'Message ID to move' },
    destinationId: { type: 'string', description: 'Destination folder ID (canonical param)' },
    // Action operation inputs
    actionMessageId: { type: 'string', description: 'Message ID for actions' },
    copyMessageId: { type: 'string', description: 'Message ID to copy' },
    copyDestinationId: {
      type: 'string',
      description: 'Destination folder ID for copy (canonical param)',
    },
    // Search operation inputs
    searchQuery: { type: 'string', description: 'Free-text search query' },
    // Folder operation inputs
    folderName: { type: 'string', description: 'Name of the new folder' },
    folderIsHidden: { type: 'boolean', description: 'Whether the new folder is hidden' },
    includeHiddenFolders: { type: 'boolean', description: 'Include hidden folders when listing' },
    // Attachment operation inputs
    attachmentId: { type: 'string', description: 'ID of the attachment to retrieve' },
    // Update message operation inputs
    categories: { type: 'string', description: 'Comma-separated category names' },
    flagStatus: { type: 'string', description: 'Follow-up flag status' },
    importance: { type: 'string', description: 'Message importance level' },
    // Calendar operation inputs
    calEventId: { type: 'string', description: 'Calendar event ID' },
    calWindowStart: { type: 'string', description: 'Start of the calendar time window (ISO 8601)' },
    calWindowEnd: { type: 'string', description: 'End of the calendar time window (ISO 8601)' },
    calMaxResults: { type: 'number', description: 'Maximum number of calendar events to return' },
    calOrderBy: { type: 'string', description: 'Order of calendar events' },
    calPageToken: { type: 'string', description: 'nextLink URL for paging calendar events' },
    calSubject: { type: 'string', description: 'Calendar event subject/title' },
    calStartDateTime: { type: 'string', description: 'Calendar event start (ISO 8601)' },
    calEndDateTime: { type: 'string', description: 'Calendar event end (ISO 8601)' },
    calBody: { type: 'string', description: 'Calendar event body content' },
    calContentType: {
      type: 'string',
      description: 'Calendar event body content type (text or html)',
    },
    calLocation: { type: 'string', description: 'Calendar event location' },
    calAttendees: { type: 'string', description: 'Attendee emails (comma-separated)' },
    calTimeZone: { type: 'string', description: 'IANA/Windows time zone name' },
    calIsAllDay: { type: 'boolean', description: 'Whether the event lasts the entire day' },
    calIsOnlineMeeting: {
      type: 'boolean',
      description: 'Attach an online meeting (Teams; work/school accounts only)',
    },
    calResponseType: {
      type: 'string',
      description: 'Invite response (accept, tentativelyAccept, or decline)',
    },
    calComment: { type: 'string', description: 'Comment to send with an invite response' },
    calSendResponse: { type: 'boolean', description: 'Whether to notify the organizer' },
  },
  outputs: {
    // Common outputs
    message: { type: 'string', description: 'Response message' },
    results: { type: 'json', description: 'Operation results' },
    // Send operation specific outputs
    status: { type: 'string', description: 'Email send status (sent)' },
    timestamp: { type: 'string', description: 'Operation timestamp' },
    // Draft operation specific outputs
    messageId: { type: 'string', description: 'Draft message ID' },
    subject: { type: 'string', description: 'Draft email subject' },
    // Read operation specific outputs
    emailCount: { type: 'number', description: 'Number of emails retrieved' },
    emails: { type: 'json', description: 'Array of email objects' },
    emailId: { type: 'string', description: 'Individual email ID' },
    emailSubject: { type: 'string', description: 'Individual email subject' },
    bodyPreview: { type: 'string', description: 'Email body preview' },
    bodyContent: { type: 'string', description: 'Full email body content' },
    sender: { type: 'json', description: 'Email sender information' },
    from: { type: 'json', description: 'Email from information' },
    recipients: { type: 'json', description: 'Email recipients' },
    receivedDateTime: { type: 'string', description: 'Email received timestamp' },
    sentDateTime: { type: 'string', description: 'Email sent timestamp' },
    hasAttachments: { type: 'boolean', description: 'Whether email has attachments' },
    attachments: {
      type: 'file[]',
      description: 'Email attachments (if includeAttachments is enabled)',
    },
    isRead: { type: 'boolean', description: 'Whether email is read' },
    importance: { type: 'string', description: 'Email importance level' },
    // Folder operation outputs
    folders: { type: 'json', description: 'Array of mail folder objects' },
    // Update message operation outputs
    categories: { type: 'json', description: 'Categories assigned to the message' },
    flagStatus: { type: 'string', description: 'Follow-up flag status of the message' },
    // Calendar operation outputs
    nextLink: { type: 'string', description: 'URL for the next page of calendar events, if any' },
    // Trigger outputs
    email: { type: 'json', description: 'Email data from trigger' },
    rawEmail: { type: 'json', description: 'Complete raw email data from Microsoft Graph API' },
  },
  triggers: {
    enabled: true,
    available: ['outlook_poller'],
  },
}

export const OutlookBlockMeta = {
  tags: ['microsoft-365', 'messaging', 'automation'],
  url: 'https://www.microsoft.com/microsoft-365/outlook',
  templates: [
    {
      icon: OutlookIcon,
      title: 'Outlook auto-responder',
      prompt:
        'Build a workflow that monitors my Outlook inbox, drafts a contextual reply for every email that needs a response using my recent threads as tone reference, and saves each reply as an Outlook draft for me to review and send.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook customer escalation to Zendesk',
      prompt:
        'Create a workflow that reads new Outlook emails from customers, classifies whether each one is a support issue, and when it is, creates a Zendesk ticket with the email body, attachments, and contact details, then replies from Outlook with the ticket number.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook executive triage',
      prompt:
        'Build a scheduled workflow that scans Outlook every hour, ranks new emails by urgency, summarizes the top items, and posts a prioritized digest to a Slack channel so executives can act without opening the inbox.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['founder', 'communication', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook invoice extractor',
      prompt:
        'Build a workflow that monitors Outlook for invoice attachments, extracts vendor, amount, due date, and line items from each PDF, and logs the results to a tracking table while moving the original email to an Invoices folder.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook follow-up reminder',
      prompt:
        'Create a workflow that scans Outlook for sent emails awaiting a reply older than three business days, drafts a polite follow-up email per thread, and saves each one as a draft in Outlook ready to send.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'communication', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook to JSM ticket router',
      prompt:
        'Build a workflow that reads support requests arriving in a shared Outlook mailbox, classifies the request type, and creates a Jira Service Management request in the correct service desk with the right request type, then replies from Outlook with the JSM portal link.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
      alsoIntegrations: ['jira_service_management'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook newsletter clipper',
      prompt:
        'Create a workflow that reads newsletters arriving in Outlook, summarizes each one into key takeaways, and appends the digest to a daily Notion page so the inbox stays clean and the insights stay searchable.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook contract clause flagger',
      prompt:
        'Build a workflow that scans Outlook for inbound contracts and amendments, extracts key clauses (payment terms, liability, termination, renewal), flags deviations from my standard terms, and replies internally with a summary and red-flag list.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis', 'automation'],
    },
  ],
  skills: [
    {
      name: 'send-email',
      description: 'Compose and send an Outlook email to one or more recipients.',
      content:
        '# Send Email\n\nSend a message from the connected Outlook account.\n\n## Steps\n1. Gather the recipients, subject, and the body content.\n2. Write a clear subject and a concise, well-structured body.\n3. Run Send Email with the recipients, subject, and body. Use Draft Email instead when the message should be reviewed before sending.\n\n## Output\nConfirm the email was sent, listing recipients and subject. If drafted, note that it awaits review.',
    },
    {
      name: 'triage-inbox',
      description: 'Read recent Outlook emails and summarize which ones need a reply or action.',
      content:
        '# Triage Inbox\n\nTurn a noisy Outlook inbox into a short action list.\n\n## Steps\n1. Run Read Email to pull recent unread messages.\n2. Classify each as needs reply, needs action, FYI, or ignore.\n3. For handled messages, run Mark as Read; leave items that still need a reply unread.\n\n## Output\nA prioritized list of emails that need attention, each with sender, subject, and the suggested next action.',
    },
    {
      name: 'forward-with-context',
      description: 'Forward an Outlook email to the right person with an added note.',
      content:
        '# Forward with Context\n\nRoute an email to the correct owner with a short explanation.\n\n## Steps\n1. Read the target email to capture its content with Read Email.\n2. Identify the correct recipient for the topic.\n3. Run Forward Email to that recipient, adding a brief note on why it is being forwarded and what is needed.\n\n## Output\nConfirm the email was forwarded, to whom, and the note that was added.',
    },
    {
      name: 'file-email-to-folder',
      description: 'Move an Outlook email to the appropriate folder to keep the inbox clean.',
      content:
        '# File Email to Folder\n\nOrganize the inbox by moving a message into the right folder.\n\n## Steps\n1. Identify the email and the destination folder.\n2. Run Move Email to relocate the message.\n3. Optionally run Mark as Read so it does not linger as unread.\n\n## Output\nConfirm the email moved, naming the source and destination folders.',
    },
  ],
} as const satisfies BlockMeta
