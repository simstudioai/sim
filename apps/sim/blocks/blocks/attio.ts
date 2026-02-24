import { AttioIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { AttioResponse } from '@/tools/attio/types'
import { getTrigger } from '@/triggers'

export const AttioBlock: BlockConfig<AttioResponse> = {
  type: 'attio',
  name: 'Attio',
  description: 'Manage records, notes, tasks, lists, comments, and more in Attio CRM',
  longDescription:
    'Connect to Attio to manage CRM records (people, companies, custom objects), notes, tasks, lists, list entries, comments, workspace members, and webhooks.',
  docsLink: 'https://docs.sim.ai/tools/attio',
  category: 'tools',
  bgColor: '#1D1E20',
  icon: AttioIcon,
  authMode: AuthMode.OAuth,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Records', id: 'list_records' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Create Record', id: 'create_record' },
        { label: 'Update Record', id: 'update_record' },
        { label: 'Delete Record', id: 'delete_record' },
        { label: 'Search Records', id: 'search_records' },
        { label: 'Assert Record (Upsert)', id: 'assert_record' },
        { label: 'List Notes', id: 'list_notes' },
        { label: 'Get Note', id: 'get_note' },
        { label: 'Create Note', id: 'create_note' },
        { label: 'Delete Note', id: 'delete_note' },
        { label: 'List Tasks', id: 'list_tasks' },
        { label: 'Create Task', id: 'create_task' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Delete Task', id: 'delete_task' },
        { label: 'List Objects', id: 'list_objects' },
        { label: 'Get Object', id: 'get_object' },
        { label: 'Create Object', id: 'create_object' },
        { label: 'Update Object', id: 'update_object' },
        { label: 'List Lists', id: 'list_lists' },
        { label: 'Get List', id: 'get_list' },
        { label: 'Create List', id: 'create_list' },
        { label: 'Update List', id: 'update_list' },
        { label: 'Query List Entries', id: 'query_list_entries' },
        { label: 'Get List Entry', id: 'get_list_entry' },
        { label: 'Create List Entry', id: 'create_list_entry' },
        { label: 'Update List Entry', id: 'update_list_entry' },
        { label: 'Delete List Entry', id: 'delete_list_entry' },
        { label: 'List Members', id: 'list_members' },
        { label: 'Get Member', id: 'get_member' },
        { label: 'Create Comment', id: 'create_comment' },
        { label: 'Get Comment', id: 'get_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
        { label: 'List Threads', id: 'list_threads' },
        { label: 'Get Thread', id: 'get_thread' },
        { label: 'List Webhooks', id: 'list_webhooks' },
        { label: 'Get Webhook', id: 'get_webhook' },
        { label: 'Create Webhook', id: 'create_webhook' },
        { label: 'Update Webhook', id: 'update_webhook' },
        { label: 'Delete Webhook', id: 'delete_webhook' },
      ],
      value: () => 'list_records',
    },

    {
      id: 'credential',
      title: 'Attio Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'attio',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Attio Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Record fields
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'short-input',
      placeholder: 'e.g. people, companies',
      condition: {
        field: 'operation',
        value: [
          'list_records',
          'get_record',
          'create_record',
          'update_record',
          'delete_record',
          'assert_record',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'list_records',
          'get_record',
          'create_record',
          'update_record',
          'delete_record',
          'assert_record',
        ],
      },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Enter the record ID',
      condition: {
        field: 'operation',
        value: ['get_record', 'update_record', 'delete_record'],
      },
      required: {
        field: 'operation',
        value: ['get_record', 'update_record', 'delete_record'],
      },
    },
    {
      id: 'matchingAttribute',
      title: 'Matching Attribute',
      type: 'short-input',
      placeholder: 'e.g. email_addresses, domains',
      condition: { field: 'operation', value: 'assert_record' },
      required: { field: 'operation', value: 'assert_record' },
    },
    {
      id: 'values',
      title: 'Values',
      type: 'long-input',
      placeholder: '{"name": "Acme Corp", "domains": [{"domain": "acme.com"}]}',
      condition: {
        field: 'operation',
        value: ['create_record', 'update_record', 'assert_record'],
      },
      required: {
        field: 'operation',
        value: ['create_record', 'update_record', 'assert_record'],
      },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Attio CRM developer. Generate Attio record attribute values as JSON based on the user's request.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON object with Attio attribute values. No explanations, no markdown, no extra text.

### ATTIO VALUES STRUCTURE
Keys are attribute slugs, values follow Attio's attribute format. Simple values can be strings; complex values are arrays of objects.

### COMMON PEOPLE ATTRIBUTES
- name: [{"first_name": "...", "last_name": "..."}]
- email_addresses: [{"email_address": "..."}]
- phone_numbers: [{"original_phone_number": "...", "country_code": "US"}]
- job_title, description, linkedin, twitter

### COMMON COMPANY ATTRIBUTES
- name: [{"value": "..."}]
- domains: [{"domain": "..."}]
- description, primary_location, categories

### EXAMPLES
Person: {"name": [{"first_name": "John", "last_name": "Doe"}], "email_addresses": [{"email_address": "john@example.com"}]}
Company: {"name": [{"value": "Acme Corp"}], "domains": [{"domain": "acme.com"}]}`,
        placeholder: 'Describe the record values you want to set...',
        generationType: 'json-object',
      },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      placeholder: '{"name": "John Smith"} (optional)',
      condition: { field: 'operation', value: 'list_records' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert Attio CRM developer. Generate Attio record query filter objects as JSON.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON filter object. No explanations, no markdown, no extra text.

### FILTER STRUCTURE
Simple: {"attribute_slug": "value"}
Advanced: {"$and": [{"attr": {"$operator": "value"}}]}
Operators: $eq, $contains, $starts_with, $ends_with, $lt, $lte, $gt, $gte, $not_empty, $in
Logical: $and, $or, $not

### EXAMPLES
Name contains: {"name": {"full_name": {"$contains": "John"}}}
Domain: {"domains": {"domain": {"$eq": "acme.com"}}}
Empty (list all): {}`,
        placeholder: 'Describe the filter you want to apply...',
        generationType: 'json-object',
      },
    },
    {
      id: 'sorts',
      title: 'Sort',
      type: 'long-input',
      placeholder: '[{"direction":"asc","attribute":"name"}] (optional)',
      condition: { field: 'operation', value: 'list_records' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an Attio record sort configuration as a JSON array.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array. No explanations, no markdown, no extra text.

### STRUCTURE
[{"direction": "asc" | "desc", "attribute": "attribute_slug"}]

### EXAMPLE
[{"direction": "asc", "attribute": "name"}]`,
        placeholder: 'Describe how to sort the records...',
        generationType: 'json-object',
      },
    },

    // Search fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search text',
      condition: { field: 'operation', value: 'search_records' },
      required: { field: 'operation', value: 'search_records' },
    },
    {
      id: 'objects',
      title: 'Object Types',
      type: 'short-input',
      placeholder: 'e.g. people,companies',
      condition: { field: 'operation', value: 'search_records' },
      required: { field: 'operation', value: 'search_records' },
    },

    // Note fields
    {
      id: 'noteParentObject',
      title: 'Parent Object Type',
      type: 'short-input',
      placeholder: 'e.g. people, companies',
      condition: { field: 'operation', value: ['list_notes', 'create_note'] },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteParentRecordId',
      title: 'Parent Record ID',
      type: 'short-input',
      placeholder: 'Enter the parent record ID',
      condition: { field: 'operation', value: ['list_notes', 'create_note'] },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Note title',
      condition: { field: 'operation', value: 'create_note' },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteContent',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Note content',
      condition: { field: 'operation', value: 'create_note' },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteFormat',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'Plaintext', id: 'plaintext' },
        { label: 'Markdown', id: 'markdown' },
      ],
      value: () => 'plaintext',
      condition: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteCreatedAt',
      title: 'Created At',
      type: 'short-input',
      placeholder: '2024-01-01T15:00:00.000Z (optional, backdate)',
      condition: { field: 'operation', value: 'create_note' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an ISO 8601 timestamp.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the ISO 8601 timestamp string. No explanations, no markdown, no extra text.

### FORMAT
YYYY-MM-DDTHH:mm:ss.SSSZ

### EXAMPLE
2024-01-15T09:30:00.000Z`,
        placeholder: 'Describe the date...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'noteMeetingId',
      title: 'Meeting ID',
      type: 'short-input',
      placeholder: 'Link to a meeting (optional)',
      condition: { field: 'operation', value: 'create_note' },
      mode: 'advanced',
    },
    {
      id: 'noteId',
      title: 'Note ID',
      type: 'short-input',
      placeholder: 'Enter the note ID',
      condition: { field: 'operation', value: ['get_note', 'delete_note'] },
      required: { field: 'operation', value: ['get_note', 'delete_note'] },
    },

    // Task fields
    {
      id: 'taskContent',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Task description (max 2000 characters)',
      condition: { field: 'operation', value: 'create_task' },
      required: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'taskDeadline',
      title: 'Deadline',
      type: 'short-input',
      placeholder: '2024-12-01T15:00:00.000Z (optional)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an ISO 8601 timestamp for a task deadline.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the ISO 8601 timestamp string. No explanations, no markdown, no extra text.

### FORMAT
YYYY-MM-DDTHH:mm:ss.SSSZ

### EXAMPLE
2024-12-01T15:00:00.000Z`,
        placeholder: 'Describe the deadline...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'taskIsCompleted',
      title: 'Completed',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'taskLinkedRecords',
      title: 'Linked Records',
      type: 'long-input',
      placeholder: '[{"target_object":"people","target_record_id":"..."}] (optional)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate Attio linked records array as JSON.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array. No explanations, no markdown, no extra text.

### STRUCTURE
[{"target_object": "object_slug", "target_record_id": "uuid"}]

### EXAMPLE
[{"target_object": "people", "target_record_id": "abc-123"}]`,
        placeholder: 'Describe the records to link...',
        generationType: 'json-object',
      },
    },
    {
      id: 'taskAssignees',
      title: 'Assignees',
      type: 'long-input',
      placeholder:
        '[{"referenced_actor_type":"workspace-member","referenced_actor_id":"..."}] (optional)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate Attio task assignees array as JSON.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array. No explanations, no markdown, no extra text.

### STRUCTURE
[{"referenced_actor_type": "workspace-member", "referenced_actor_id": "uuid"}]

### EXAMPLE
[{"referenced_actor_type": "workspace-member", "referenced_actor_id": "abc-123"}]`,
        placeholder: 'Describe who to assign...',
        generationType: 'json-object',
      },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'Enter the task ID',
      condition: { field: 'operation', value: ['update_task', 'delete_task'] },
      required: { field: 'operation', value: ['update_task', 'delete_task'] },
    },
    {
      id: 'taskFilterObject',
      title: 'Linked Object Type',
      type: 'short-input',
      placeholder: 'e.g. people, companies (optional)',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'taskFilterRecordId',
      title: 'Linked Record ID',
      type: 'short-input',
      placeholder: 'Filter by linked record ID (optional)',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'taskFilterAssignee',
      title: 'Assignee',
      type: 'short-input',
      placeholder: 'Filter by assignee email or ID (optional)',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'taskFilterCompleted',
      title: 'Completed Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Completed', id: 'true' },
        { label: 'Incomplete', id: 'false' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'list_tasks' },
    },

    // Object fields
    {
      id: 'objectIdOrSlug',
      title: 'Object ID or Slug',
      type: 'short-input',
      placeholder: 'e.g. people, companies, or UUID',
      condition: { field: 'operation', value: ['get_object', 'update_object'] },
      required: { field: 'operation', value: ['get_object', 'update_object'] },
    },
    {
      id: 'objectApiSlug',
      title: 'API Slug',
      type: 'short-input',
      placeholder: 'e.g. projects',
      condition: { field: 'operation', value: ['create_object', 'update_object'] },
      required: { field: 'operation', value: 'create_object' },
    },
    {
      id: 'objectSingularNoun',
      title: 'Singular Name',
      type: 'short-input',
      placeholder: 'e.g. Project',
      condition: { field: 'operation', value: ['create_object', 'update_object'] },
      required: { field: 'operation', value: 'create_object' },
    },
    {
      id: 'objectPluralNoun',
      title: 'Plural Name',
      type: 'short-input',
      placeholder: 'e.g. Projects',
      condition: { field: 'operation', value: ['create_object', 'update_object'] },
      required: { field: 'operation', value: 'create_object' },
    },

    // List fields
    {
      id: 'listIdOrSlug',
      title: 'List ID or Slug',
      type: 'short-input',
      placeholder: 'Enter the list ID or slug',
      condition: {
        field: 'operation',
        value: [
          'get_list',
          'update_list',
          'query_list_entries',
          'get_list_entry',
          'create_list_entry',
          'update_list_entry',
          'delete_list_entry',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_list',
          'update_list',
          'query_list_entries',
          'get_list_entry',
          'create_list_entry',
          'update_list_entry',
          'delete_list_entry',
        ],
      },
    },
    {
      id: 'listName',
      title: 'List Name',
      type: 'short-input',
      placeholder: 'Enter the list name',
      condition: { field: 'operation', value: ['create_list', 'update_list'] },
      required: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'listParentObject',
      title: 'Parent Object',
      type: 'short-input',
      placeholder: 'e.g. people, companies',
      condition: { field: 'operation', value: 'create_list' },
      required: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'listApiSlug',
      title: 'API Slug',
      type: 'short-input',
      placeholder: 'e.g. my_list (optional, auto-generated)',
      condition: { field: 'operation', value: ['create_list', 'update_list'] },
      mode: 'advanced',
    },
    {
      id: 'listWorkspaceAccess',
      title: 'Workspace Access',
      type: 'dropdown',
      options: [
        { label: 'Full Access', id: 'full-access' },
        { label: 'Read & Write', id: 'read-and-write' },
        { label: 'Read Only', id: 'read-only' },
      ],
      value: () => 'full-access',
      condition: { field: 'operation', value: ['create_list', 'update_list'] },
    },

    // List entry fields
    {
      id: 'entryId',
      title: 'Entry ID',
      type: 'short-input',
      placeholder: 'Enter the entry ID',
      condition: {
        field: 'operation',
        value: ['get_list_entry', 'update_list_entry', 'delete_list_entry'],
      },
      required: {
        field: 'operation',
        value: ['get_list_entry', 'update_list_entry', 'delete_list_entry'],
      },
    },
    {
      id: 'entryParentRecordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Record ID to add to the list',
      condition: { field: 'operation', value: 'create_list_entry' },
      required: { field: 'operation', value: 'create_list_entry' },
    },
    {
      id: 'entryParentObject',
      title: 'Record Object Type',
      type: 'short-input',
      placeholder: 'e.g. people, companies',
      condition: { field: 'operation', value: 'create_list_entry' },
      required: { field: 'operation', value: 'create_list_entry' },
    },
    {
      id: 'entryValues',
      title: 'Entry Values',
      type: 'long-input',
      placeholder: '{"attribute_slug": "value"} (optional)',
      condition: {
        field: 'operation',
        value: ['create_list_entry', 'update_list_entry'],
      },
      required: { field: 'operation', value: 'update_list_entry' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate Attio list entry attribute values as JSON.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON object. No explanations, no markdown, no extra text.

### STRUCTURE
Keys are list attribute slugs. Values follow Attio attribute format.

### EXAMPLE
{"status": [{"status": {"title": "Active"}}], "priority": [{"option": {"title": "High"}}]}`,
        placeholder: 'Describe the entry values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'entryFilter',
      title: 'Filter',
      type: 'long-input',
      placeholder: '{"attribute": {"$operator": "value"}} (optional)',
      condition: { field: 'operation', value: 'query_list_entries' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an Attio list entry query filter as JSON.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON filter object. No explanations, no markdown, no extra text.

### FILTER STRUCTURE
Same as record filters. Operators: $eq, $contains, $lt, $gt, $not_empty, $in, etc.
Logical: $and, $or, $not

### EXAMPLE
{"status": {"status": {"title": {"$eq": "Active"}}}}`,
        placeholder: 'Describe the filter...',
        generationType: 'json-object',
      },
    },
    {
      id: 'entrySorts',
      title: 'Sort',
      type: 'long-input',
      placeholder: '[{"direction":"asc","attribute":"created_at"}] (optional)',
      condition: { field: 'operation', value: 'query_list_entries' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an Attio list entry sort configuration as a JSON array.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array. No explanations, no markdown, no extra text.

### STRUCTURE
[{"direction": "asc" | "desc", "attribute": "attribute_slug"}]

### EXAMPLE
[{"direction": "asc", "attribute": "created_at"}]`,
        placeholder: 'Describe how to sort the entries...',
        generationType: 'json-object',
      },
    },

    // Member fields
    {
      id: 'memberId',
      title: 'Member ID',
      type: 'short-input',
      placeholder: 'Enter the workspace member ID',
      condition: { field: 'operation', value: 'get_member' },
      required: { field: 'operation', value: 'get_member' },
    },

    // Comment fields
    {
      id: 'commentContent',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Comment content',
      condition: { field: 'operation', value: 'create_comment' },
      required: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'commentFormat',
      title: 'Format',
      type: 'dropdown',
      options: [{ label: 'Plaintext', id: 'plaintext' }],
      value: () => 'plaintext',
      condition: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'commentAuthorType',
      title: 'Author Type',
      type: 'short-input',
      placeholder: 'e.g. workspace-member',
      condition: { field: 'operation', value: 'create_comment' },
      required: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'commentAuthorId',
      title: 'Author ID',
      type: 'short-input',
      placeholder: 'Workspace member ID of the author',
      condition: { field: 'operation', value: 'create_comment' },
      required: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'commentList',
      title: 'List',
      type: 'short-input',
      placeholder: 'List ID or slug',
      condition: { field: 'operation', value: 'create_comment' },
      required: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'commentEntryId',
      title: 'Entry ID',
      type: 'short-input',
      placeholder: 'List entry ID to comment on',
      condition: { field: 'operation', value: 'create_comment' },
      required: { field: 'operation', value: 'create_comment' },
    },
    {
      id: 'commentThreadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Reply to thread (optional, omit to start new)',
      condition: { field: 'operation', value: 'create_comment' },
      mode: 'advanced',
    },
    {
      id: 'commentCreatedAt',
      title: 'Created At',
      type: 'short-input',
      placeholder: '2024-01-01T15:00:00.000Z (optional, backdate)',
      condition: { field: 'operation', value: 'create_comment' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate an ISO 8601 timestamp.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the ISO 8601 timestamp string. No explanations, no markdown, no extra text.

### FORMAT
YYYY-MM-DDTHH:mm:ss.SSSZ

### EXAMPLE
2024-01-15T09:30:00.000Z`,
        placeholder: 'Describe the date...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'Enter the comment ID',
      condition: { field: 'operation', value: ['get_comment', 'delete_comment'] },
      required: { field: 'operation', value: ['get_comment', 'delete_comment'] },
    },

    // Thread fields
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Enter the thread ID',
      condition: { field: 'operation', value: 'get_thread' },
      required: { field: 'operation', value: 'get_thread' },
    },
    {
      id: 'threadFilterRecordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Filter by record ID (optional)',
      condition: { field: 'operation', value: 'list_threads' },
    },
    {
      id: 'threadFilterObject',
      title: 'Object Type',
      type: 'short-input',
      placeholder: 'e.g. people (required with Record ID)',
      condition: { field: 'operation', value: 'list_threads' },
    },
    {
      id: 'threadFilterEntryId',
      title: 'Entry ID',
      type: 'short-input',
      placeholder: 'Filter by entry ID (optional)',
      condition: { field: 'operation', value: 'list_threads' },
    },
    {
      id: 'threadFilterList',
      title: 'List',
      type: 'short-input',
      placeholder: 'List ID or slug (required with Entry ID)',
      condition: { field: 'operation', value: 'list_threads' },
    },

    // Webhook fields
    {
      id: 'webhookId',
      title: 'Webhook ID',
      type: 'short-input',
      placeholder: 'Enter the webhook ID',
      condition: {
        field: 'operation',
        value: ['get_webhook', 'update_webhook', 'delete_webhook'],
      },
      required: {
        field: 'operation',
        value: ['get_webhook', 'update_webhook', 'delete_webhook'],
      },
    },
    {
      id: 'webhookTargetUrl',
      title: 'Target URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhook',
      condition: { field: 'operation', value: ['create_webhook', 'update_webhook'] },
      required: { field: 'operation', value: 'create_webhook' },
    },
    {
      id: 'webhookSubscriptions',
      title: 'Subscriptions',
      type: 'long-input',
      placeholder: '[{"event_type":"record.created","filter":{"object_id":"..."}}]',
      condition: { field: 'operation', value: ['create_webhook', 'update_webhook'] },
      required: { field: 'operation', value: 'create_webhook' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate Attio webhook subscriptions array as JSON.

### CONTEXT
{context}

### CRITICAL INSTRUCTION
Return ONLY the JSON array. No explanations, no markdown, no extra text.

### STRUCTURE
[{"event_type": "event.type", "filter": {"object_id": "uuid"}}]

### AVAILABLE EVENT TYPES
record.created, record.updated, record.deleted, record.merged
note.created, note.updated, note.deleted, note-content.updated
task.created, task.updated, task.deleted
list.created, list.updated, list.deleted
list-entry.created, list-entry.updated, list-entry.deleted
comment.created, comment.resolved, comment.unresolved, comment.deleted
object-attribute.created, object-attribute.updated
list-attribute.created, list-attribute.updated
workspace-member.created

### EXAMPLE
[{"event_type": "record.created", "filter": {"object_id": "people"}}]`,
        placeholder: 'Describe which events to subscribe to...',
        generationType: 'json-object',
      },
    },

    // Shared limit
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (optional)',
      condition: {
        field: 'operation',
        value: [
          'list_records',
          'search_records',
          'list_notes',
          'list_tasks',
          'query_list_entries',
          'list_threads',
          'list_webhooks',
        ],
      },
    },
    ...getTrigger('attio_record_created').subBlocks,
    ...getTrigger('attio_record_updated').subBlocks,
    ...getTrigger('attio_record_deleted').subBlocks,
    ...getTrigger('attio_record_merged').subBlocks,
    ...getTrigger('attio_note_created').subBlocks,
    ...getTrigger('attio_note_updated').subBlocks,
    ...getTrigger('attio_note_deleted').subBlocks,
    ...getTrigger('attio_task_created').subBlocks,
    ...getTrigger('attio_task_updated').subBlocks,
    ...getTrigger('attio_task_deleted').subBlocks,
    ...getTrigger('attio_comment_created').subBlocks,
    ...getTrigger('attio_comment_resolved').subBlocks,
    ...getTrigger('attio_comment_unresolved').subBlocks,
    ...getTrigger('attio_comment_deleted').subBlocks,
    ...getTrigger('attio_list_entry_created').subBlocks,
    ...getTrigger('attio_list_entry_updated').subBlocks,
    ...getTrigger('attio_list_entry_deleted').subBlocks,
    ...getTrigger('attio_webhook').subBlocks,
  ],

  triggers: {
    enabled: true,
    available: [
      'attio_record_created',
      'attio_record_updated',
      'attio_record_deleted',
      'attio_record_merged',
      'attio_note_created',
      'attio_note_updated',
      'attio_note_deleted',
      'attio_task_created',
      'attio_task_updated',
      'attio_task_deleted',
      'attio_comment_created',
      'attio_comment_resolved',
      'attio_comment_unresolved',
      'attio_comment_deleted',
      'attio_list_entry_created',
      'attio_list_entry_updated',
      'attio_list_entry_deleted',
      'attio_webhook',
    ],
  },

  tools: {
    access: [
      'attio_list_records',
      'attio_get_record',
      'attio_create_record',
      'attio_update_record',
      'attio_delete_record',
      'attio_search_records',
      'attio_assert_record',
      'attio_list_notes',
      'attio_get_note',
      'attio_create_note',
      'attio_delete_note',
      'attio_list_tasks',
      'attio_create_task',
      'attio_update_task',
      'attio_delete_task',
      'attio_list_objects',
      'attio_get_object',
      'attio_create_object',
      'attio_update_object',
      'attio_list_lists',
      'attio_get_list',
      'attio_create_list',
      'attio_update_list',
      'attio_query_list_entries',
      'attio_get_list_entry',
      'attio_create_list_entry',
      'attio_update_list_entry',
      'attio_delete_list_entry',
      'attio_list_members',
      'attio_get_member',
      'attio_create_comment',
      'attio_get_comment',
      'attio_delete_comment',
      'attio_list_threads',
      'attio_get_thread',
      'attio_list_webhooks',
      'attio_get_webhook',
      'attio_create_webhook',
      'attio_update_webhook',
      'attio_delete_webhook',
    ],
    config: {
      tool: (params) => `attio_${params.operation}`,
      params: (params) => {
        const cleanParams: Record<string, unknown> = {
          oauthCredential: params.oauthCredential,
        }

        // Record params
        if (params.objectType) cleanParams.objectType = params.objectType
        if (params.recordId) cleanParams.recordId = params.recordId
        if (params.matchingAttribute) cleanParams.matchingAttribute = params.matchingAttribute
        if (params.values) cleanParams.values = params.values
        if (params.filter) cleanParams.filter = params.filter
        if (params.sorts) cleanParams.sorts = params.sorts
        if (params.query) cleanParams.query = params.query
        if (params.objects) cleanParams.objects = params.objects

        // Note params
        if (params.noteParentObject) cleanParams.parentObject = params.noteParentObject
        if (params.noteParentRecordId) cleanParams.parentRecordId = params.noteParentRecordId
        if (params.noteTitle) cleanParams.title = params.noteTitle
        if (params.noteContent) cleanParams.content = params.noteContent
        if (params.noteFormat) cleanParams.format = params.noteFormat
        if (params.noteId) cleanParams.noteId = params.noteId
        if (params.noteCreatedAt) cleanParams.createdAt = params.noteCreatedAt
        if (params.noteMeetingId) cleanParams.meetingId = params.noteMeetingId

        // Task params
        if (params.taskContent) cleanParams.content = params.taskContent
        if (params.taskDeadline) cleanParams.deadlineAt = params.taskDeadline
        if (params.taskIsCompleted !== undefined)
          cleanParams.isCompleted =
            params.taskIsCompleted === 'true' || params.taskIsCompleted === true
        if (params.taskLinkedRecords) cleanParams.linkedRecords = params.taskLinkedRecords
        if (params.taskAssignees) cleanParams.assignees = params.taskAssignees
        if (params.taskId) cleanParams.taskId = params.taskId
        if (params.taskFilterObject) cleanParams.linkedObject = params.taskFilterObject
        if (params.taskFilterRecordId) cleanParams.linkedRecordId = params.taskFilterRecordId
        if (params.taskFilterAssignee) cleanParams.assignee = params.taskFilterAssignee
        if (params.taskFilterCompleted && params.taskFilterCompleted !== 'all')
          cleanParams.isCompleted = params.taskFilterCompleted === 'true'

        // Object params
        if (params.objectIdOrSlug) cleanParams.object = params.objectIdOrSlug
        if (params.objectApiSlug) cleanParams.apiSlug = params.objectApiSlug
        if (params.objectSingularNoun) cleanParams.singularNoun = params.objectSingularNoun
        if (params.objectPluralNoun) cleanParams.pluralNoun = params.objectPluralNoun

        // List params
        if (params.listIdOrSlug) cleanParams.list = params.listIdOrSlug
        if (params.listName) cleanParams.name = params.listName
        if (params.listParentObject) cleanParams.parentObject = params.listParentObject
        if (params.listApiSlug) cleanParams.apiSlug = params.listApiSlug
        if (params.listWorkspaceAccess) cleanParams.workspaceAccess = params.listWorkspaceAccess

        // List entry params
        if (params.entryId) cleanParams.entryId = params.entryId
        if (params.entryParentRecordId) cleanParams.parentRecordId = params.entryParentRecordId
        if (params.entryParentObject) cleanParams.parentObject = params.entryParentObject
        if (params.entryValues) cleanParams.entryValues = params.entryValues
        if (params.entryFilter) cleanParams.filter = params.entryFilter
        if (params.entrySorts) cleanParams.sorts = params.entrySorts

        // Member params
        if (params.memberId) cleanParams.memberId = params.memberId

        // Comment params
        if (params.commentContent) cleanParams.content = params.commentContent
        if (params.commentFormat) cleanParams.format = params.commentFormat
        if (params.commentAuthorType) cleanParams.authorType = params.commentAuthorType
        if (params.commentAuthorId) cleanParams.authorId = params.commentAuthorId
        if (params.commentList) cleanParams.list = params.commentList
        if (params.commentEntryId) cleanParams.entryId = params.commentEntryId
        if (params.commentThreadId) cleanParams.threadId = params.commentThreadId
        if (params.commentCreatedAt) cleanParams.createdAt = params.commentCreatedAt
        if (params.commentId) cleanParams.commentId = params.commentId

        // Thread params
        if (params.threadId) cleanParams.threadId = params.threadId
        if (params.threadFilterRecordId) cleanParams.recordId = params.threadFilterRecordId
        if (params.threadFilterObject) cleanParams.object = params.threadFilterObject
        if (params.threadFilterEntryId) cleanParams.entryId = params.threadFilterEntryId
        if (params.threadFilterList) cleanParams.list = params.threadFilterList

        // Webhook params
        if (params.webhookId) cleanParams.webhookId = params.webhookId
        if (params.webhookTargetUrl) cleanParams.targetUrl = params.webhookTargetUrl
        if (params.webhookSubscriptions) cleanParams.subscriptions = params.webhookSubscriptions

        // Shared params
        if (params.limit) cleanParams.limit = Number(params.limit)

        return cleanParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'The operation to perform' },
    oauthCredential: { type: 'string', description: 'Attio OAuth credential' },
    objectType: { type: 'string', description: 'Object type slug' },
    recordId: { type: 'string', description: 'Record ID' },
    matchingAttribute: { type: 'string', description: 'Matching attribute for upsert' },
    values: { type: 'json', description: 'Record attribute values' },
    filter: { type: 'json', description: 'Query filter' },
    sorts: { type: 'json', description: 'Sort configuration' },
    query: { type: 'string', description: 'Search query text' },
    objects: { type: 'string', description: 'Comma-separated object type slugs' },
    noteParentObject: { type: 'string', description: 'Parent object type for notes' },
    noteParentRecordId: { type: 'string', description: 'Parent record ID for notes' },
    noteTitle: { type: 'string', description: 'Note title' },
    noteContent: { type: 'string', description: 'Note content' },
    noteFormat: { type: 'string', description: 'Note content format' },
    noteId: { type: 'string', description: 'Note ID' },
    noteCreatedAt: { type: 'string', description: 'Note creation timestamp (backdate)' },
    noteMeetingId: { type: 'string', description: 'Meeting ID to link to note' },
    taskContent: { type: 'string', description: 'Task content' },
    taskDeadline: { type: 'string', description: 'Task deadline' },
    taskIsCompleted: { type: 'string', description: 'Task completion status' },
    taskLinkedRecords: { type: 'json', description: 'Linked records JSON array' },
    taskAssignees: { type: 'json', description: 'Assignees JSON array' },
    taskId: { type: 'string', description: 'Task ID' },
    objectIdOrSlug: { type: 'string', description: 'Object ID or slug' },
    objectApiSlug: { type: 'string', description: 'Object API slug' },
    objectSingularNoun: { type: 'string', description: 'Object singular name' },
    objectPluralNoun: { type: 'string', description: 'Object plural name' },
    listIdOrSlug: { type: 'string', description: 'List ID or slug' },
    listName: { type: 'string', description: 'List name' },
    listParentObject: { type: 'string', description: 'List parent object' },
    listApiSlug: { type: 'string', description: 'List API slug' },
    listWorkspaceAccess: { type: 'string', description: 'List workspace-level access' },
    entryId: { type: 'string', description: 'List entry ID' },
    entryParentRecordId: { type: 'string', description: 'Record ID for list entry' },
    entryParentObject: { type: 'string', description: 'Record object type for list entry' },
    entryValues: { type: 'json', description: 'List entry attribute values' },
    entryFilter: { type: 'json', description: 'List entry query filter' },
    entrySorts: { type: 'json', description: 'List entry sort configuration' },
    memberId: { type: 'string', description: 'Workspace member ID' },
    commentContent: { type: 'string', description: 'Comment content' },
    commentFormat: { type: 'string', description: 'Comment format' },
    commentAuthorType: { type: 'string', description: 'Comment author type' },
    commentAuthorId: { type: 'string', description: 'Comment author ID' },
    commentList: { type: 'string', description: 'List for comment' },
    commentEntryId: { type: 'string', description: 'Entry ID for comment' },
    commentThreadId: { type: 'string', description: 'Thread ID to reply to' },
    commentCreatedAt: { type: 'string', description: 'Comment creation timestamp (backdate)' },
    commentId: { type: 'string', description: 'Comment ID' },
    threadId: { type: 'string', description: 'Thread ID' },
    webhookId: { type: 'string', description: 'Webhook ID' },
    webhookTargetUrl: { type: 'string', description: 'Webhook target URL' },
    webhookSubscriptions: { type: 'json', description: 'Webhook event subscriptions' },
    limit: { type: 'string', description: 'Maximum number of results' },
  },

  outputs: {
    records: { type: 'json', description: 'Array of records' },
    record: { type: 'json', description: 'A single record' },
    recordId: { type: 'string', description: 'The record ID' },
    webUrl: { type: 'string', description: 'URL to view the record in Attio' },
    results: { type: 'json', description: 'Search results' },
    notes: { type: 'json', description: 'Array of notes' },
    noteId: { type: 'string', description: 'The note ID' },
    title: { type: 'string', description: 'The note title' },
    contentPlaintext: { type: 'string', description: 'Content as plaintext' },
    contentMarkdown: { type: 'string', description: 'Content as markdown' },
    tasks: { type: 'json', description: 'Array of tasks' },
    taskId: { type: 'string', description: 'The task ID' },
    content: { type: 'string', description: 'Task or note content' },
    deadlineAt: { type: 'string', description: 'Task deadline' },
    isCompleted: { type: 'boolean', description: 'Task completion status' },
    linkedRecords: { type: 'json', description: 'Linked records' },
    assignees: { type: 'json', description: 'Task assignees' },
    objects: { type: 'json', description: 'Array of objects' },
    objectId: { type: 'string', description: 'The object ID' },
    apiSlug: { type: 'string', description: 'The API slug' },
    singularNoun: { type: 'string', description: 'Singular display name' },
    pluralNoun: { type: 'string', description: 'Plural display name' },
    lists: { type: 'json', description: 'Array of lists' },
    listId: { type: 'string', description: 'The list ID' },
    name: { type: 'string', description: 'The list name' },
    entries: { type: 'json', description: 'Array of list entries' },
    entryId: { type: 'string', description: 'The entry ID' },
    entryValues: { type: 'json', description: 'Entry attribute values' },
    members: { type: 'json', description: 'Array of workspace members' },
    memberId: { type: 'string', description: 'The member ID' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    emailAddress: { type: 'string', description: 'Email address' },
    accessLevel: { type: 'string', description: 'Access level' },
    commentId: { type: 'string', description: 'The comment ID' },
    threadId: { type: 'string', description: 'The thread ID' },
    threads: { type: 'json', description: 'Array of threads' },
    comments: { type: 'json', description: 'Array of comments in a thread' },
    webhooks: { type: 'json', description: 'Array of webhooks' },
    webhookId: { type: 'string', description: 'The webhook ID' },
    targetUrl: { type: 'string', description: 'Webhook target URL' },
    subscriptions: { type: 'json', description: 'Webhook event subscriptions' },
    status: { type: 'string', description: 'Webhook status' },
    secret: { type: 'string', description: 'Webhook signing secret (only on create)' },
    count: { type: 'number', description: 'Number of items returned' },
    deleted: { type: 'boolean', description: 'Whether the item was deleted' },
    createdAt: { type: 'string', description: 'When the item was created' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
