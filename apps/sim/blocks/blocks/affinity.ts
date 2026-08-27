import { AffinityIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'
import type { AffinityCollectionResponse } from '@/tools/affinity/types'

/** Operations scoped to a company or person through the shared field endpoints. */
const FIELD_ENTITY_OPERATIONS = [
  'list_entity_lists',
  'list_entity_list_entries',
  'list_entity_relationships',
  'list_field_metadata',
  'list_field_dropdown_options',
  'list_entity_field_values',
  'get_entity_field_value',
  'update_entity_field_value',
  'batch_update_entity_fields',
] as const

/** Operations that address one company, person, or opportunity by ID. */
const ENTITY_ID_OPERATIONS = [
  'list_entity_notes',
  'list_entity_lists',
  'list_entity_list_entries',
  'list_entity_relationships',
  'list_entity_field_values',
  'get_entity_field_value',
  'update_entity_field_value',
  'batch_update_entity_fields',
  'create_reminder',
] as const

/** Operations that address one list. */
const LIST_ID_OPERATIONS = [
  'get_list',
  'list_list_fields',
  'list_list_field_dropdown_options',
  'create_list_field_dropdown_option',
  'get_list_field_dropdown_option',
  'update_list_field_dropdown_option',
  'delete_list_field_dropdown_option',
  'list_list_entries',
  'search_list_entries',
  'get_list_entry',
  'list_list_entry_fields',
  'get_list_entry_field',
  'update_list_entry_field',
  'batch_update_list_entry_fields',
  'list_list_entry_field_value_changes',
  'list_saved_views',
  'get_saved_view',
  'list_saved_view_entries',
] as const

/** Operations that address one row of a list. */
const LIST_ENTRY_ID_OPERATIONS = [
  'get_list_entry',
  'list_list_entry_fields',
  'get_list_entry_field',
  'update_list_entry_field',
  'batch_update_list_entry_fields',
  'list_list_entry_field_value_changes',
] as const

/** Operations that address one field by ID. */
const FIELD_ID_OPERATIONS = [
  'list_field_dropdown_options',
  'get_entity_field_value',
  'update_entity_field_value',
  'list_list_field_dropdown_options',
  'create_list_field_dropdown_option',
  'get_list_field_dropdown_option',
  'update_list_field_dropdown_option',
  'delete_list_field_dropdown_option',
  'get_list_entry_field',
  'update_list_entry_field',
] as const

/** Operations that address one dropdown option. */
const DROPDOWN_OPTION_ID_OPERATIONS = [
  'get_list_field_dropdown_option',
  'update_list_field_dropdown_option',
  'delete_list_field_dropdown_option',
] as const

/** Operations that write a dropdown option. */
const DROPDOWN_OPTION_WRITE_OPERATIONS = [
  'create_list_field_dropdown_option',
  'update_list_field_dropdown_option',
] as const

/** Operations that address one note. */
const NOTE_ID_OPERATIONS = [
  'get_note',
  'update_note',
  'delete_note',
  'list_note_replies',
  'list_note_attached_companies',
  'list_note_attached_persons',
  'list_note_attached_opportunities',
] as const

/** Operations that write a note body or its attachments. */
const NOTE_WRITE_OPERATIONS = ['create_note', 'update_note'] as const

/** Operations that address one merge or merge task. */
const MERGE_OPERATIONS = [
  'list_merges',
  'create_merge',
  'get_merge',
  'list_merge_tasks',
  'get_merge_task',
] as const

/** Operations that take a filter-and-sort search body. */
const ENTITY_SEARCH_OPERATIONS = [
  'search_companies',
  'search_persons',
  'search_list_entries',
] as const

/** Operations that take a natural-language prompt. */
const PROMPT_OPERATIONS = ['search_notes', 'search_files', 'semantic_search'] as const

/** Operations that take a keyword-search scope. */
const KEYWORD_SEARCH_OPERATIONS = ['search_notes', 'search_files'] as const

/** Operations that choose which field values come back with each record. */
const FIELD_SELECTION_OPERATIONS = [
  'list_companies',
  'get_company',
  'search_companies',
  'list_persons',
  'get_person',
  'search_persons',
  'list_list_entries',
  'search_list_entries',
  'get_list_entry',
] as const

/** Operations that page a field-value collection and can narrow it. */
const FIELD_VALUE_SELECTION_OPERATIONS = [
  'list_entity_field_values',
  'list_list_entry_fields',
] as const

/** Operations that write a single field value. */
const FIELD_VALUE_WRITE_OPERATIONS = [
  'update_entity_field_value',
  'update_list_entry_field',
] as const

/** Operations that write many field values at once. */
const FIELD_BATCH_WRITE_OPERATIONS = [
  'batch_update_entity_fields',
  'batch_update_list_entry_fields',
] as const

/** Operations that restrict a collection to an explicit set of IDs. */
const ID_FILTER_OPERATIONS = ['list_companies', 'list_persons', 'list_opportunities'] as const

/** Operations that accept an Affinity Filtering Language expression. */
const FILTER_OPERATIONS = [
  'list_calls',
  'list_chat_messages',
  'list_emails',
  'list_meetings',
  'list_entity_notes',
  'list_entity_relationships',
  'list_field_metadata',
  'list_list_fields',
  'list_list_entry_field_value_changes',
  'list_notes',
  'list_note_replies',
  'list_reminders',
  'list_transcripts',
  'list_users',
  'list_merges',
  'list_merge_tasks',
  'list_field_value_changes',
] as const

/** Operations whose endpoint reports the total size of the collection on request. */
const TOTAL_COUNT_OPERATIONS = [
  'search_companies',
  'search_persons',
  'search_list_entries',
  'list_entity_notes',
  'list_entity_relationships',
  'list_notes',
  'list_note_replies',
  'list_note_attached_companies',
  'list_note_attached_persons',
  'list_note_attached_opportunities',
  'list_reminders',
  'list_transcripts',
  'list_transcript_fragments',
  'list_coworker_connections',
  'list_investor_executive_connections',
] as const

/** Operations paged with an opaque cursor. */
const CURSOR_OPERATIONS = [
  'list_companies',
  'search_companies',
  'list_persons',
  'search_persons',
  'list_opportunities',
  'list_entity_notes',
  'list_entity_lists',
  'list_entity_list_entries',
  'list_entity_relationships',
  'list_field_metadata',
  'list_field_dropdown_options',
  'list_entity_field_values',
  'list_lists',
  'list_list_fields',
  'list_list_field_dropdown_options',
  'list_list_entries',
  'search_list_entries',
  'list_list_entry_fields',
  'list_list_entry_field_value_changes',
  'list_saved_views',
  'list_saved_view_entries',
  'list_notes',
  'list_note_replies',
  'list_note_attached_companies',
  'list_note_attached_persons',
  'list_note_attached_opportunities',
  'list_calls',
  'list_chat_messages',
  'list_emails',
  'list_meetings',
  'list_transcripts',
  'list_transcript_fragments',
  'list_reminders',
  'list_merges',
  'list_merge_tasks',
  'list_coworker_connections',
  'list_investor_executive_connections',
  'list_field_value_changes',
  'list_users',
] as const

/** Operations that cap how many rows come back — page size, or a search result count. */
const LIMIT_OPERATIONS = [...CURSOR_OPERATIONS, ...PROMPT_OPERATIONS] as const

/** Note reads that can ask for the reply count and the attached-record previews. */
const NOTE_INCLUDES_OPERATIONS = ['list_notes', 'get_note'] as const

/** Field-metadata reads that can ask for filterability and sortability. */
const FIELD_INCLUDES_OPERATIONS = ['list_field_metadata', 'list_list_fields'] as const

/** Operations that read inferred connections, which require a scoping filter. */
const CONNECTION_OPERATIONS = [
  'list_coworker_connections',
  'list_investor_executive_connections',
] as const

/** Colors Affinity allows on a dropdown option. */
const DROPDOWN_COLOR_OPTIONS = [
  { label: 'White', id: 'white' },
  { label: 'Gray', id: 'gray' },
  { label: 'Blue', id: 'blue' },
  { label: 'Green', id: 'green' },
  { label: 'Purple', id: 'purple' },
  { label: 'Orange', id: 'orange' },
  { label: 'Red', id: 'red' },
]

const FILTERS_WAND_PROMPT = `Generate an Affinity v2 search "filters" object.

The shape is {"operator":"and"|"or","filters":[...]}. Each leaf is {"valueType":"...","fieldId":"...","operator":"...","value":...}, and a leaf may itself be a nested group with its own operator and filters.
valueType names the field's value type — person, person-multi, company, company-multi, filterable-text, filterable-text-multi, number, number-multi, datetime, location, location-multi, text, ranked-dropdown, dropdown, dropdown-multi, formula-number, or interaction.
Some leaves also take an "attributeId" when the filter applies to an attribute of the field rather than the field itself.
Field IDs and the operators each field accepts come from the field metadata endpoints, so use IDs that were actually returned rather than guessing.

Return ONLY the JSON object.`

const FIELD_VALUE_WAND_PROMPT = `Generate an Affinity v2 field "value" object.

The shape is {"type":"<valueType>","data":<value>}. Examples by type:
text / filterable-text: {"type":"text","data":"Series B"}
number: {"type":"number","data":42}
datetime: {"type":"datetime","data":"2026-01-31T00:00:00Z"}
dropdown / ranked-dropdown: {"type":"dropdown","data":{"dropdownOptionId":7}}
person / company: {"type":"person","data":{"id":123}}
person-multi / company-multi: {"type":"person-multi","data":[{"id":123},{"id":456}]}
location: {"type":"location","data":{"streetAddress":null,"city":"Berlin","state":null,"country":"Germany","continent":"Europe"}}
Pass "data": null to clear the field.

Return ONLY the JSON object.`

/**
 * Memoized lookup over the block's own tool list.
 *
 * Built from `access` rather than a second copy of the ids, so the operation
 * guard can never drift from the tools the block actually declares.
 */
let affinityToolIdCache: ReadonlySet<string> | undefined

function affinityToolIds(): ReadonlySet<string> {
  affinityToolIdCache ??= new Set(AffinityBlock.tools.access)
  return affinityToolIdCache
}

export const AffinityBlock: BlockConfig<AffinityCollectionResponse<string>> = {
  type: 'affinity',
  name: 'Affinity',
  description: 'Read and write companies, people, lists, notes, and relationships in Affinity',
  longDescription:
    'Integrates the Affinity v2 API into the workflow. Read and search companies, people, and opportunities, page the rows of any list or saved view, read and write field values one at a time or a hundred at once, write and reply to notes, create reminders, follow logged calls, emails, meetings, and transcripts, find warm introductions through shared work and investment history, search notes and files by keyword, find companies from a description in plain language, and follow the field-value change feed for delta sync. What each operation can reach depends on the permissions granted to the API key.',
  docsLink: 'https://docs.sim.ai/integrations/affinity',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#1B1C1E',
  icon: AffinityIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Affinity',
    sentences: {
      byOperation: {
        list_companies: ['List companies'],
        get_company: [{ text: 'Look up company', field: 'companyId', core: true }],
        search_companies: ['Search companies', { text: 'matching', field: 'searchTerm' }],
        list_persons: ['List people'],
        get_person: [{ text: 'Look up person', field: 'personId', core: true }],
        search_persons: ['Search people', { text: 'matching', field: 'searchTerm' }],
        list_opportunities: ['List opportunities'],
        get_opportunity: [{ text: 'Look up opportunity', field: 'opportunityId', core: true }],
        list_entity_notes: [{ text: 'List the notes on', field: 'entityId', core: true }],
        list_entity_lists: [{ text: 'List the lists holding', field: 'entityId', core: true }],
        list_entity_list_entries: [
          { text: 'List the rows holding', field: 'entityId', core: true },
        ],
        list_entity_relationships: [
          { text: 'List the relationships of', field: 'entityId', core: true },
        ],
        list_field_metadata: [{ text: 'List the fields on', field: 'fieldEntityType', core: true }],
        list_field_dropdown_options: [
          { text: 'List the options on field', field: 'fieldId', core: true },
        ],
        list_entity_field_values: [
          { text: 'Read the field values on', field: 'entityId', core: true },
        ],
        get_entity_field_value: [
          { text: 'Read field', field: 'fieldId', core: true },
          { text: 'on', field: 'entityId', core: true },
        ],
        update_entity_field_value: [
          { text: 'Set field', field: 'fieldId', core: true },
          { text: 'on', field: 'entityId', core: true },
        ],
        batch_update_entity_fields: [
          { text: 'Update the fields on', field: 'entityId', core: true },
        ],
        list_lists: ['List lists', { text: 'matching', field: 'term' }],
        create_list: [{ text: 'Create list', field: 'listName', core: true }],
        get_list: [{ text: 'Look up list', field: 'listId', core: true }],
        list_list_fields: [{ text: 'List the fields on list', field: 'listId', core: true }],
        list_list_field_dropdown_options: [
          { text: 'List the options on list field', field: 'fieldId', core: true },
        ],
        create_list_field_dropdown_option: [
          { text: 'Add option', field: 'optionText', core: true },
          { text: 'to field', field: 'fieldId', core: true },
        ],
        get_list_field_dropdown_option: [
          { text: 'Read dropdown option', field: 'dropdownOptionId', core: true },
        ],
        update_list_field_dropdown_option: [
          { text: 'Rename dropdown option', field: 'dropdownOptionId', core: true },
          { text: 'to', field: 'optionText', core: true },
        ],
        delete_list_field_dropdown_option: [
          { text: 'Delete dropdown option', field: 'dropdownOptionId', core: true },
        ],
        list_list_entries: [{ text: 'List the rows of list', field: 'listId', core: true }],
        search_list_entries: [
          { text: 'Search the rows of list', field: 'listId', core: true },
          { text: 'matching', field: 'searchTerm' },
        ],
        get_list_entry: [{ text: 'Look up list row', field: 'listEntryId', core: true }],
        list_list_entry_fields: [
          { text: 'Read the field values on row', field: 'listEntryId', core: true },
        ],
        get_list_entry_field: [
          { text: 'Read field', field: 'fieldId', core: true },
          { text: 'on row', field: 'listEntryId', core: true },
        ],
        update_list_entry_field: [
          { text: 'Set field', field: 'fieldId', core: true },
          { text: 'on row', field: 'listEntryId', core: true },
        ],
        batch_update_list_entry_fields: [
          { text: 'Update the fields on row', field: 'listEntryId', core: true },
        ],
        list_list_entry_field_value_changes: [
          { text: 'Read the field history of row', field: 'listEntryId', core: true },
        ],
        list_saved_views: [{ text: 'List the saved views of list', field: 'listId', core: true }],
        get_saved_view: [{ text: 'Look up saved view', field: 'viewId', core: true }],
        list_saved_view_entries: [
          { text: 'List the rows of saved view', field: 'viewId', core: true },
        ],
        list_notes: ['List notes'],
        create_note: ['Write a note'],
        search_notes: [{ text: 'Search notes for', field: 'prompt', core: true }],
        get_note: [{ text: 'Read note', field: 'noteId', core: true }],
        update_note: [{ text: 'Update note', field: 'noteId', core: true }],
        delete_note: [{ text: 'Delete note', field: 'noteId', core: true }],
        list_note_replies: [{ text: 'List the replies to note', field: 'noteId', core: true }],
        list_note_attached_companies: [
          { text: 'List the companies attached to note', field: 'noteId', core: true },
        ],
        list_note_attached_persons: [
          { text: 'List the people attached to note', field: 'noteId', core: true },
        ],
        list_note_attached_opportunities: [
          { text: 'List the opportunities attached to note', field: 'noteId', core: true },
        ],
        list_calls: ['List logged calls'],
        list_chat_messages: ['List logged chat messages'],
        list_emails: ['List email metadata'],
        list_meetings: ['List meetings'],
        list_transcripts: ['List meeting transcripts'],
        get_transcript: [{ text: 'Read transcript', field: 'transcriptId', core: true }],
        list_transcript_fragments: [
          { text: 'Read every fragment of transcript', field: 'transcriptId', core: true },
        ],
        list_reminders: ['List reminders'],
        create_reminder: [
          { text: 'Set a reminder about', field: 'entityId', core: true },
          { text: 'due', field: 'dueDate', core: true },
        ],
        list_merges: ['List merges'],
        create_merge: [
          { text: 'Merge', field: 'duplicateId', core: true },
          { text: 'into', field: 'primaryId', core: true },
        ],
        get_merge: [{ text: 'Read merge', field: 'mergeId', core: true }],
        list_merge_tasks: ['List merge tasks'],
        get_merge_task: [{ text: 'Read merge task', field: 'taskId', core: true }],
        semantic_search: [{ text: 'Find companies matching', field: 'prompt', core: true }],
        search_files: [{ text: 'Search files for', field: 'prompt', core: true }],
        list_coworker_connections: ['List coworker introductions into a company'],
        list_investor_executive_connections: ['List investor introductions into a company'],
        list_field_value_changes: ['List field value changes across the workspace'],
        list_users: ['List internal users', { text: 'matching', field: 'term' }],
        get_user: [{ text: 'Look up user', field: 'userId', core: true }],
        get_current_user: ['Verify the API key and read the current user'],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Companies', id: 'list_companies' },
        { label: 'Get Company', id: 'get_company' },
        { label: 'Search Companies', id: 'search_companies' },
        { label: 'List People', id: 'list_persons' },
        { label: 'Get Person', id: 'get_person' },
        { label: 'Search People', id: 'search_persons' },
        { label: 'List Opportunities', id: 'list_opportunities' },
        { label: 'Get Opportunity', id: 'get_opportunity' },
        { label: 'List Notes On Entity', id: 'list_entity_notes' },
        { label: 'List Lists Holding Entity', id: 'list_entity_lists' },
        { label: 'List Rows Holding Entity', id: 'list_entity_list_entries' },
        { label: 'List Entity Relationships', id: 'list_entity_relationships' },
        { label: 'List Field Metadata', id: 'list_field_metadata' },
        { label: 'List Field Dropdown Options', id: 'list_field_dropdown_options' },
        { label: 'List Entity Field Values', id: 'list_entity_field_values' },
        { label: 'Get Entity Field Value', id: 'get_entity_field_value' },
        { label: 'Update Entity Field Value', id: 'update_entity_field_value' },
        { label: 'Batch Update Entity Fields', id: 'batch_update_entity_fields' },
        { label: 'List Lists', id: 'list_lists' },
        { label: 'Create List', id: 'create_list' },
        { label: 'Get List', id: 'get_list' },
        { label: 'List List Fields', id: 'list_list_fields' },
        { label: 'List List Field Dropdown Options', id: 'list_list_field_dropdown_options' },
        { label: 'Create List Field Dropdown Option', id: 'create_list_field_dropdown_option' },
        { label: 'Get List Field Dropdown Option', id: 'get_list_field_dropdown_option' },
        { label: 'Update List Field Dropdown Option', id: 'update_list_field_dropdown_option' },
        { label: 'Delete List Field Dropdown Option', id: 'delete_list_field_dropdown_option' },
        { label: 'List List Entries', id: 'list_list_entries' },
        { label: 'Search List Entries', id: 'search_list_entries' },
        { label: 'Get List Entry', id: 'get_list_entry' },
        { label: 'List List Entry Fields', id: 'list_list_entry_fields' },
        { label: 'Get List Entry Field', id: 'get_list_entry_field' },
        { label: 'Update List Entry Field', id: 'update_list_entry_field' },
        { label: 'Batch Update List Entry Fields', id: 'batch_update_list_entry_fields' },
        {
          label: 'List List Entry Field Value Changes',
          id: 'list_list_entry_field_value_changes',
        },
        { label: 'List Saved Views', id: 'list_saved_views' },
        { label: 'Get Saved View', id: 'get_saved_view' },
        { label: 'List Saved View Entries', id: 'list_saved_view_entries' },
        { label: 'List Notes', id: 'list_notes' },
        { label: 'Create Note', id: 'create_note' },
        { label: 'Search Notes', id: 'search_notes' },
        { label: 'Get Note', id: 'get_note' },
        { label: 'Update Note', id: 'update_note' },
        { label: 'Delete Note', id: 'delete_note' },
        { label: 'List Note Replies', id: 'list_note_replies' },
        { label: 'List Note Attached Companies', id: 'list_note_attached_companies' },
        { label: 'List Note Attached People', id: 'list_note_attached_persons' },
        { label: 'List Note Attached Opportunities', id: 'list_note_attached_opportunities' },
        { label: 'List Calls', id: 'list_calls' },
        { label: 'List Chat Messages', id: 'list_chat_messages' },
        { label: 'List Emails', id: 'list_emails' },
        { label: 'List Meetings', id: 'list_meetings' },
        { label: 'List Transcripts', id: 'list_transcripts' },
        { label: 'Get Transcript', id: 'get_transcript' },
        { label: 'List Transcript Fragments', id: 'list_transcript_fragments' },
        { label: 'List Reminders', id: 'list_reminders' },
        { label: 'Create Reminder', id: 'create_reminder' },
        { label: 'List Merges', id: 'list_merges' },
        { label: 'Create Merge', id: 'create_merge' },
        { label: 'Get Merge', id: 'get_merge' },
        { label: 'List Merge Tasks', id: 'list_merge_tasks' },
        { label: 'Get Merge Task', id: 'get_merge_task' },
        { label: 'Semantic Search', id: 'semantic_search' },
        { label: 'Search Files', id: 'search_files' },
        { label: 'List Coworker Connections', id: 'list_coworker_connections' },
        {
          label: 'List Investor Executive Connections',
          id: 'list_investor_executive_connections',
        },
        { label: 'List Field Value Changes', id: 'list_field_value_changes' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Get Current User', id: 'get_current_user' },
      ],
      value: () => 'list_companies',
    },
    {
      id: 'apiKey',
      title: 'Affinity API Key',
      type: 'short-input',
      placeholder: 'Enter your Affinity API key',
      password: true,
      required: true,
    },
    {
      id: 'fieldEntityType',
      title: 'Entity Type',
      type: 'dropdown',
      options: [
        { label: 'Companies', id: 'companies' },
        { label: 'People', id: 'persons' },
      ],
      condition: { field: 'operation', value: [...FIELD_ENTITY_OPERATIONS] },
      required: { field: 'operation', value: [...FIELD_ENTITY_OPERATIONS] },
    },
    {
      id: 'noteEntityType',
      title: 'Entity Type',
      type: 'dropdown',
      options: [
        { label: 'Companies', id: 'companies' },
        { label: 'People', id: 'persons' },
        { label: 'Opportunities', id: 'opportunities' },
      ],
      condition: { field: 'operation', value: 'list_entity_notes' },
      required: { field: 'operation', value: 'list_entity_notes' },
    },
    {
      id: 'mergeEntityType',
      title: 'Entity Type',
      type: 'dropdown',
      options: [
        { label: 'Companies', id: 'companies' },
        { label: 'People', id: 'persons' },
      ],
      condition: { field: 'operation', value: [...MERGE_OPERATIONS] },
      required: { field: 'operation', value: [...MERGE_OPERATIONS] },
    },
    {
      id: 'reminderEntityType',
      title: 'Entity Type',
      type: 'dropdown',
      options: [
        { label: 'Company', id: 'company' },
        { label: 'Person', id: 'person' },
        { label: 'Opportunity', id: 'opportunity' },
      ],
      condition: { field: 'operation', value: 'create_reminder' },
      required: { field: 'operation', value: 'create_reminder' },
    },
    {
      id: 'entityId',
      title: 'Entity ID',
      type: 'short-input',
      placeholder: 'ID of the company, person, or opportunity',
      condition: { field: 'operation', value: [...ENTITY_ID_OPERATIONS] },
      required: { field: 'operation', value: [...ENTITY_ID_OPERATIONS] },
    },
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: 'get_company' },
      required: { field: 'operation', value: 'get_company' },
    },
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: 'get_person' },
      required: { field: 'operation', value: 'get_person' },
    },
    {
      id: 'opportunityId',
      title: 'Opportunity ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: 'get_opportunity' },
      required: { field: 'operation', value: 'get_opportunity' },
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: [...LIST_ID_OPERATIONS] },
      required: { field: 'operation', value: [...LIST_ID_OPERATIONS] },
    },
    {
      id: 'listEntryId',
      title: 'List Entry ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: [...LIST_ENTRY_ID_OPERATIONS] },
      required: { field: 'operation', value: [...LIST_ENTRY_ID_OPERATIONS] },
    },
    {
      id: 'viewId',
      title: 'Saved View ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: ['get_saved_view', 'list_saved_view_entries'] },
      required: { field: 'operation', value: ['get_saved_view', 'list_saved_view_entries'] },
    },
    {
      id: 'fieldId',
      title: 'Field ID',
      type: 'short-input',
      placeholder: 'e.g. affinity-data-location',
      condition: { field: 'operation', value: [...FIELD_ID_OPERATIONS] },
      required: { field: 'operation', value: [...FIELD_ID_OPERATIONS] },
    },
    {
      id: 'dropdownOptionId',
      title: 'Dropdown Option ID',
      type: 'short-input',
      placeholder: 'e.g. 7',
      condition: { field: 'operation', value: [...DROPDOWN_OPTION_ID_OPERATIONS] },
      required: { field: 'operation', value: [...DROPDOWN_OPTION_ID_OPERATIONS] },
    },
    {
      id: 'noteId',
      title: 'Note ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: [...NOTE_ID_OPERATIONS] },
      required: { field: 'operation', value: [...NOTE_ID_OPERATIONS] },
    },
    {
      id: 'transcriptId',
      title: 'Transcript ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: ['get_transcript', 'list_transcript_fragments'] },
      required: { field: 'operation', value: ['get_transcript', 'list_transcript_fragments'] },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Also works with the matching person ID',
      condition: { field: 'operation', value: 'get_user' },
      required: { field: 'operation', value: 'get_user' },
    },
    {
      id: 'mergeId',
      title: 'Merge ID',
      type: 'short-input',
      placeholder: 'e.g. 12345',
      condition: { field: 'operation', value: 'get_merge' },
      required: { field: 'operation', value: 'get_merge' },
    },
    {
      id: 'taskId',
      title: 'Merge Task ID',
      type: 'short-input',
      placeholder: 'Task ID returned when the merge started',
      condition: { field: 'operation', value: 'get_merge_task' },
      required: { field: 'operation', value: 'get_merge_task' },
    },
    {
      id: 'listName',
      title: 'List Name',
      type: 'short-input',
      placeholder: 'e.g. Q3 Pipeline',
      condition: { field: 'operation', value: 'create_list' },
      required: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'listType',
      title: 'List Type',
      type: 'dropdown',
      options: [
        { label: 'Company', id: 'company' },
        { label: 'Person', id: 'person' },
        { label: 'Opportunity', id: 'opportunity' },
      ],
      condition: { field: 'operation', value: 'create_list' },
      required: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'isPublic',
      title: 'Visible To Everyone',
      type: 'switch',
      condition: { field: 'operation', value: 'create_list' },
    },
    {
      id: 'optionType',
      title: 'Option Type',
      type: 'dropdown',
      options: [
        { label: 'Dropdown', id: 'dropdown' },
        { label: 'Ranked Dropdown', id: 'ranked-dropdown' },
        { label: 'Status Dropdown', id: 'status-dropdown' },
      ],
      condition: { field: 'operation', value: 'create_list_field_dropdown_option' },
      required: { field: 'operation', value: 'create_list_field_dropdown_option' },
    },
    {
      id: 'optionText',
      title: 'Option Label',
      type: 'short-input',
      placeholder: 'e.g. Due Diligence',
      condition: { field: 'operation', value: [...DROPDOWN_OPTION_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_list_field_dropdown_option' },
    },
    {
      id: 'optionRank',
      title: 'Option Rank',
      type: 'short-input',
      placeholder: 'Sort order. Required on a ranked or status option',
      condition: { field: 'operation', value: [...DROPDOWN_OPTION_WRITE_OPERATIONS] },
      required: {
        field: 'operation',
        value: 'create_list_field_dropdown_option',
        and: { field: 'optionType', value: ['ranked-dropdown', 'status-dropdown'] },
      },
    },
    {
      id: 'optionColor',
      title: 'Option Color',
      type: 'dropdown',
      options: DROPDOWN_COLOR_OPTIONS,
      condition: { field: 'operation', value: [...DROPDOWN_OPTION_WRITE_OPERATIONS] },
      required: {
        field: 'operation',
        value: 'create_list_field_dropdown_option',
        and: { field: 'optionType', value: ['ranked-dropdown', 'status-dropdown'] },
      },
    },
    {
      id: 'optionStatusCategory',
      title: 'Status Category',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Won', id: 'won' },
        { label: 'Lost', id: 'lost' },
        { label: 'On Hold', id: 'on-hold' },
      ],
      condition: { field: 'operation', value: [...DROPDOWN_OPTION_WRITE_OPERATIONS] },
      required: {
        field: 'operation',
        value: 'create_list_field_dropdown_option',
        and: { field: 'optionType', value: 'status-dropdown' },
      },
    },
    {
      id: 'optionWinRate',
      title: 'Win Rate',
      type: 'short-input',
      placeholder: 'Status options only',
      mode: 'advanced',
      condition: { field: 'operation', value: [...DROPDOWN_OPTION_WRITE_OPERATIONS] },
    },
    {
      id: 'fieldValue',
      title: 'Value',
      type: 'code',
      language: 'json',
      placeholder: '{"type":"text","data":"Series B"}',
      condition: { field: 'operation', value: [...FIELD_VALUE_WRITE_OPERATIONS] },
      required: { field: 'operation', value: [...FIELD_VALUE_WRITE_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt: FIELD_VALUE_WAND_PROMPT,
        generationType: 'json-object',
      },
    },
    {
      id: 'fieldUpdates',
      title: 'Field Updates',
      type: 'code',
      language: 'json',
      placeholder: '[{"id":"affinity-data-status","value":{"type":"text","data":"Active"}}]',
      condition: { field: 'operation', value: [...FIELD_BATCH_WRITE_OPERATIONS] },
      required: { field: 'operation', value: [...FIELD_BATCH_WRITE_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt: FIELD_VALUE_WAND_PROMPT,
        generationType: 'json-array',
      },
    },
    {
      id: 'searchFilters',
      title: 'Filters',
      type: 'code',
      language: 'json',
      placeholder: '{"operator":"and","filters":[]}',
      condition: { field: 'operation', value: [...ENTITY_SEARCH_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt: FILTERS_WAND_PROMPT,
        generationType: 'json-object',
      },
    },
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Free-text term to match',
      condition: { field: 'operation', value: [...ENTITY_SEARCH_OPERATIONS] },
    },
    {
      id: 'searchSorts',
      title: 'Sorts',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '[{"fieldId":"affinity-data-name","direction":"asc"}]',
      condition: { field: 'operation', value: [...ENTITY_SEARCH_OPERATIONS] },
    },
    {
      id: 'searchTermFieldIds',
      title: 'Search Term Field IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["affinity-data-name"]',
      condition: { field: 'operation', value: [...ENTITY_SEARCH_OPERATIONS] },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'e.g. climate tech companies in our pipeline',
      condition: { field: 'operation', value: [...PROMPT_OPERATIONS] },
      required: { field: 'operation', value: [...PROMPT_OPERATIONS] },
    },
    {
      id: 'searchIds',
      title: 'Restrict To IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '[1, 2, 3]',
      condition: { field: 'operation', value: [...KEYWORD_SEARCH_OPERATIONS] },
    },
    {
      id: 'scopeCompanyId',
      title: 'Restrict To Company ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Cannot be combined with Restrict To IDs',
      condition: { field: 'operation', value: [...KEYWORD_SEARCH_OPERATIONS] },
    },
    {
      id: 'listIds',
      title: 'Restrict To List IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '[1, 2]',
      condition: { field: 'operation', value: 'semantic_search' },
    },
    {
      id: 'noteType',
      title: 'Note Type',
      type: 'dropdown',
      options: [
        { label: 'Attached To Records', id: 'entities' },
        { label: 'Anchored To An Interaction', id: 'interaction' },
        { label: 'Reply To A Note', id: 'user-reply' },
      ],
      condition: { field: 'operation', value: 'create_note' },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteHtml',
      title: 'Note Body',
      type: 'long-input',
      placeholder: '<p>Met the founding team today.</p>',
      condition: { field: 'operation', value: [...NOTE_WRITE_OPERATIONS] },
      required: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'interactionId',
      title: 'Interaction ID',
      type: 'short-input',
      placeholder: 'Meeting, call, or chat message to anchor the note to',
      condition: {
        field: 'operation',
        value: 'create_note',
        and: { field: 'noteType', value: 'interaction' },
      },
      required: {
        field: 'operation',
        value: 'create_note',
        and: { field: 'noteType', value: 'interaction' },
      },
    },
    {
      id: 'interactionType',
      title: 'Interaction Type',
      type: 'dropdown',
      options: [
        { label: 'Meeting', id: 'meeting' },
        { label: 'Call', id: 'call' },
        { label: 'Chat Message', id: 'chat-message' },
      ],
      condition: {
        field: 'operation',
        value: 'create_note',
        and: { field: 'noteType', value: 'interaction' },
      },
      required: {
        field: 'operation',
        value: 'create_note',
        and: { field: 'noteType', value: 'interaction' },
      },
    },
    {
      id: 'parentId',
      title: 'Parent Note ID',
      type: 'short-input',
      placeholder: 'Note being replied to',
      condition: {
        field: 'operation',
        value: 'create_note',
        and: { field: 'noteType', value: 'user-reply' },
      },
      required: {
        field: 'operation',
        value: 'create_note',
        and: { field: 'noteType', value: 'user-reply' },
      },
    },
    {
      id: 'noteCompanyIds',
      title: 'Attached Companies',
      type: 'code',
      language: 'json',
      placeholder: '[1, 2]',
      condition: { field: 'operation', value: [...NOTE_WRITE_OPERATIONS] },
    },
    {
      id: 'notePersonIds',
      title: 'Attached People',
      type: 'code',
      language: 'json',
      placeholder: '[1, 2]',
      condition: { field: 'operation', value: [...NOTE_WRITE_OPERATIONS] },
    },
    {
      id: 'noteOpportunityIds',
      title: 'Attached Opportunities',
      type: 'code',
      language: 'json',
      placeholder: '[1, 2]',
      condition: { field: 'operation', value: [...NOTE_WRITE_OPERATIONS] },
    },
    {
      id: 'creatorId',
      title: 'Author',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Person ID to attribute the note to. Defaults to the API key holder',
      condition: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteCreatedAt',
      title: 'Backdate To',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 2026-01-31T09:00:00Z',
      condition: { field: 'operation', value: 'create_note' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'primaryId',
      title: 'Primary ID',
      type: 'short-input',
      placeholder: 'Record to keep',
      condition: { field: 'operation', value: 'create_merge' },
      required: { field: 'operation', value: 'create_merge' },
    },
    {
      id: 'duplicateId',
      title: 'Duplicate ID',
      type: 'short-input',
      placeholder: 'Record to fold in',
      condition: { field: 'operation', value: 'create_merge' },
      required: { field: 'operation', value: 'create_merge' },
    },
    {
      id: 'reminderType',
      title: 'Reminder Type',
      type: 'dropdown',
      options: [
        { label: 'One Time', id: 'one-time' },
        { label: 'Recurring', id: 'recurring' },
      ],
      condition: { field: 'operation', value: 'create_reminder' },
      required: { field: 'operation', value: 'create_reminder' },
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'Required for one-time; computed from the period when omitted',
      condition: { field: 'operation', value: 'create_reminder' },
      required: {
        field: 'operation',
        value: 'create_reminder',
        and: { field: 'reminderType', value: 'one-time' },
      },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'reminderContent',
      title: 'Reminder Text',
      type: 'long-input',
      placeholder: 'e.g. Follow up on the data room request',
      condition: { field: 'operation', value: 'create_reminder' },
    },
    {
      id: 'resetTrigger',
      title: 'Reset Trigger',
      type: 'dropdown',
      options: [
        { label: 'Any Interaction', id: 'interaction' },
        { label: 'Email', id: 'email' },
        { label: 'Event', id: 'event' },
      ],
      condition: {
        field: 'operation',
        value: 'create_reminder',
        and: { field: 'reminderType', value: 'recurring' },
      },
      required: {
        field: 'operation',
        value: 'create_reminder',
        and: { field: 'reminderType', value: 'recurring' },
      },
    },
    {
      id: 'periodDays',
      title: 'Period In Days',
      type: 'short-input',
      placeholder: 'e.g. 30',
      condition: {
        field: 'operation',
        value: 'create_reminder',
        and: { field: 'reminderType', value: 'recurring' },
      },
      required: {
        field: 'operation',
        value: 'create_reminder',
        and: { field: 'reminderType', value: 'recurring' },
      },
    },
    {
      id: 'ownerId',
      title: 'Assign To',
      type: 'short-input',
      placeholder: 'Internal user ID the reminder belongs to',
      condition: { field: 'operation', value: 'create_reminder' },
      required: { field: 'operation', value: 'create_reminder' },
    },
    {
      id: 'connectionFilter',
      title: 'Target Company Filter',
      type: 'short-input',
      placeholder: 'e.g. target.currentCompany.id=123',
      condition: { field: 'operation', value: [...CONNECTION_OPERATIONS] },
      required: { field: 'operation', value: [...CONNECTION_OPERATIONS] },
    },
    {
      id: 'term',
      title: 'Name Search',
      type: 'short-input',
      placeholder: 'Case-insensitive substring match',
      condition: { field: 'operation', value: ['list_lists', 'list_users'] },
    },
    {
      id: 'entityIds',
      title: 'Restrict To IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '[1, 2, 3]',
      condition: { field: 'operation', value: [...ID_FILTER_OPERATIONS] },
    },
    {
      id: 'fieldIds',
      title: 'Field IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["affinity-data-location"]',
      condition: { field: 'operation', value: [...FIELD_SELECTION_OPERATIONS] },
    },
    {
      id: 'fieldTypes',
      title: 'Field Types',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["enriched","global"]',
      condition: { field: 'operation', value: [...FIELD_SELECTION_OPERATIONS] },
    },
    {
      id: 'valueFieldIds',
      title: 'Field IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["affinity-data-location"]',
      condition: { field: 'operation', value: [...FIELD_VALUE_SELECTION_OPERATIONS] },
    },
    {
      id: 'valueFieldTypes',
      title: 'Field Types',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["enriched","global"]',
      condition: { field: 'operation', value: [...FIELD_VALUE_SELECTION_OPERATIONS] },
    },
    {
      id: 'noteIncludes',
      title: 'Include',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["repliesCount","personsPreview","companiesPreview","opportunitiesPreview"]',
      condition: { field: 'operation', value: [...NOTE_INCLUDES_OPERATIONS] },
    },
    {
      id: 'fieldIncludes',
      title: 'Include',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["filterability","sortability"]',
      condition: { field: 'operation', value: [...FIELD_INCLUDES_OPERATIONS] },
    },
    {
      id: 'relationshipOrderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Strongest first', id: '-interactionScore' },
        { label: 'Weakest first', id: 'interactionScore' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_entity_relationships' },
    },
    {
      id: 'changeOrderBy',
      title: 'Order By',
      type: 'dropdown',
      options: [
        { label: 'Oldest first', id: 'changedAt' },
        { label: 'Newest first', id: '-changedAt' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_field_value_changes' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Affinity Filtering Language, e.g. createdAt>=2026-01-01',
      condition: { field: 'operation', value: [...FILTER_OPERATIONS] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Rows per page, or matches to return on a search',
      condition: { field: 'operation', value: [...LIMIT_OPERATIONS] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'nextCursor from the previous page',
      condition: { field: 'operation', value: [...CURSOR_OPERATIONS] },
    },
    {
      id: 'totalCount',
      title: 'Include Total Count',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: [...TOTAL_COUNT_OPERATIONS] },
    },
  ],

  tools: {
    access: [
      'affinity_batch_update_entity_fields',
      'affinity_batch_update_list_entry_fields',
      'affinity_create_list',
      'affinity_create_list_field_dropdown_option',
      'affinity_create_merge',
      'affinity_create_note',
      'affinity_create_reminder',
      'affinity_delete_list_field_dropdown_option',
      'affinity_delete_note',
      'affinity_get_company',
      'affinity_get_current_user',
      'affinity_get_entity_field_value',
      'affinity_get_list',
      'affinity_get_list_entry',
      'affinity_get_list_entry_field',
      'affinity_get_list_field_dropdown_option',
      'affinity_get_merge',
      'affinity_get_merge_task',
      'affinity_get_note',
      'affinity_get_opportunity',
      'affinity_get_person',
      'affinity_get_saved_view',
      'affinity_get_transcript',
      'affinity_get_user',
      'affinity_list_calls',
      'affinity_list_chat_messages',
      'affinity_list_companies',
      'affinity_list_coworker_connections',
      'affinity_list_emails',
      'affinity_list_entity_field_values',
      'affinity_list_entity_list_entries',
      'affinity_list_entity_lists',
      'affinity_list_entity_notes',
      'affinity_list_entity_relationships',
      'affinity_list_field_dropdown_options',
      'affinity_list_field_metadata',
      'affinity_list_field_value_changes',
      'affinity_list_investor_executive_connections',
      'affinity_list_list_entries',
      'affinity_list_list_entry_field_value_changes',
      'affinity_list_list_entry_fields',
      'affinity_list_list_field_dropdown_options',
      'affinity_list_list_fields',
      'affinity_list_lists',
      'affinity_list_meetings',
      'affinity_list_merge_tasks',
      'affinity_list_merges',
      'affinity_list_note_attached_companies',
      'affinity_list_note_attached_opportunities',
      'affinity_list_note_attached_persons',
      'affinity_list_note_replies',
      'affinity_list_notes',
      'affinity_list_opportunities',
      'affinity_list_persons',
      'affinity_list_reminders',
      'affinity_list_saved_view_entries',
      'affinity_list_saved_views',
      'affinity_list_transcript_fragments',
      'affinity_list_transcripts',
      'affinity_list_users',
      'affinity_search_companies',
      'affinity_search_files',
      'affinity_search_list_entries',
      'affinity_search_notes',
      'affinity_search_persons',
      'affinity_semantic_search',
      'affinity_update_entity_field_value',
      'affinity_update_list_entry_field',
      'affinity_update_list_field_dropdown_option',
      'affinity_update_note',
    ],
    config: {
      tool: (params) => {
        const toolId = `affinity_${String(params.operation ?? '')}`
        if (!affinityToolIds().has(toolId)) {
          throw new Error(`Invalid Affinity operation: ${String(params.operation ?? '')}`)
        }
        return toolId
      },
      /**
       * Every key the block can send is assigned unconditionally.
       *
       * The executor merges the raw subblock state underneath this result, so
       * omitting a key leaves the previous operation's value on the wire — an
       * advanced field is serialized on non-emptiness alone, even while the UI
       * hides it. `undefined` is what actually drops one.
       */
      params: (params) => {
        const operation = String(params.operation ?? '')
        const isIn = (group: readonly string[]) => group.includes(operation)

        const isKeywordSearch = isIn(KEYWORD_SEARCH_OPERATIONS)
        const isDropdownWrite = isIn(DROPDOWN_OPTION_WRITE_OPERATIONS)
        const isEntitySearch = isIn(ENTITY_SEARCH_OPERATIONS)
        const isFieldValueSelection = isIn(FIELD_VALUE_SELECTION_OPERATIONS)
        const isNoteWrite = isIn(NOTE_WRITE_OPERATIONS)
        const isCreateNote = operation === 'create_note'
        const isCreateList = operation === 'create_list'
        const isCreateReminder = operation === 'create_reminder'

        let entityType: unknown
        if (isIn(FIELD_ENTITY_OPERATIONS)) entityType = params.fieldEntityType
        else if (operation === 'list_entity_notes') entityType = params.noteEntityType
        else if (isIn(MERGE_OPERATIONS)) entityType = params.mergeEntityType
        else if (isCreateReminder) entityType = params.reminderEntityType

        let type: unknown
        if (isCreateList) type = params.listType
        else if (operation === 'create_list_field_dropdown_option') type = params.optionType
        else if (isCreateNote) type = params.noteType
        else if (isCreateReminder) type = params.reminderType

        let filter: unknown
        if (isIn(CONNECTION_OPERATIONS)) filter = params.connectionFilter
        else if (isIn(FILTER_OPERATIONS)) filter = params.filter

        let orderBy: unknown
        if (operation === 'list_entity_relationships') orderBy = params.relationshipOrderBy
        else if (operation === 'list_field_value_changes') orderBy = params.changeOrderBy

        let includes: unknown
        if (isIn(NOTE_INCLUDES_OPERATIONS)) includes = params.noteIncludes
        else if (isIn(FIELD_INCLUDES_OPERATIONS)) includes = params.fieldIncludes

        let ids: unknown
        if (isIn(ID_FILTER_OPERATIONS)) ids = params.entityIds
        else if (isKeywordSearch) ids = params.searchIds
        else if (isFieldValueSelection) ids = params.valueFieldIds

        return {
          apiKey: params.apiKey,
          entityType,
          type,
          filter,
          orderBy,
          includes,
          ids,
          entityId: isIn(ENTITY_ID_OPERATIONS) ? params.entityId : undefined,
          companyId:
            operation === 'get_company'
              ? params.companyId
              : isKeywordSearch
                ? params.scopeCompanyId
                : undefined,
          personId: operation === 'get_person' ? params.personId : undefined,
          opportunityId: operation === 'get_opportunity' ? params.opportunityId : undefined,
          listId: isIn(LIST_ID_OPERATIONS) ? params.listId : undefined,
          listEntryId: isIn(LIST_ENTRY_ID_OPERATIONS) ? params.listEntryId : undefined,
          viewId:
            operation === 'get_saved_view' || operation === 'list_saved_view_entries'
              ? params.viewId
              : undefined,
          fieldId: isIn(FIELD_ID_OPERATIONS) ? params.fieldId : undefined,
          dropdownOptionId: isIn(DROPDOWN_OPTION_ID_OPERATIONS)
            ? params.dropdownOptionId
            : undefined,
          noteId: isIn(NOTE_ID_OPERATIONS) ? params.noteId : undefined,
          transcriptId:
            operation === 'get_transcript' || operation === 'list_transcript_fragments'
              ? params.transcriptId
              : undefined,
          userId: operation === 'get_user' ? params.userId : undefined,
          mergeId: operation === 'get_merge' ? params.mergeId : undefined,
          taskId: operation === 'get_merge_task' ? params.taskId : undefined,
          types: isFieldValueSelection ? params.valueFieldTypes : undefined,
          fieldIds: isIn(FIELD_SELECTION_OPERATIONS) ? params.fieldIds : undefined,
          fieldTypes: isIn(FIELD_SELECTION_OPERATIONS) ? params.fieldTypes : undefined,
          filters: isEntitySearch ? params.searchFilters : undefined,
          sorts: isEntitySearch ? params.searchSorts : undefined,
          searchTerm: isEntitySearch ? params.searchTerm : undefined,
          searchFieldIds: isEntitySearch ? params.searchTermFieldIds : undefined,
          prompt: isIn(PROMPT_OPERATIONS) ? params.prompt : undefined,
          listIds: operation === 'semantic_search' ? params.listIds : undefined,
          term: operation === 'list_lists' || operation === 'list_users' ? params.term : undefined,
          name: isCreateList ? params.listName : undefined,
          isPublic: isCreateList ? parseOptionalBooleanInput(params.isPublic) : undefined,
          text: isDropdownWrite ? params.optionText : undefined,
          rank: isDropdownWrite
            ? parseOptionalNumberInput(params.optionRank, 'Option Rank', { integer: true, min: 0 })
            : undefined,
          color: isDropdownWrite ? params.optionColor : undefined,
          statusCategory: isDropdownWrite ? params.optionStatusCategory : undefined,
          winRate: isDropdownWrite
            ? parseOptionalNumberInput(params.optionWinRate, 'Win Rate', {
                integer: true,
                min: 0,
                max: 100,
              })
            : undefined,
          value: isIn(FIELD_VALUE_WRITE_OPERATIONS) ? params.fieldValue : undefined,
          updates: isIn(FIELD_BATCH_WRITE_OPERATIONS) ? params.fieldUpdates : undefined,
          html: isNoteWrite ? params.noteHtml : undefined,
          companyIds: isNoteWrite ? params.noteCompanyIds : undefined,
          personIds: isNoteWrite ? params.notePersonIds : undefined,
          opportunityIds: isNoteWrite ? params.noteOpportunityIds : undefined,
          interactionId: isCreateNote ? params.interactionId : undefined,
          interactionType: isCreateNote ? params.interactionType : undefined,
          parentId: isCreateNote ? params.parentId : undefined,
          creatorId: isCreateNote ? params.creatorId : undefined,
          createdAt: isCreateNote ? params.noteCreatedAt : undefined,
          primaryId: operation === 'create_merge' ? params.primaryId : undefined,
          duplicateId: operation === 'create_merge' ? params.duplicateId : undefined,
          dueDate: isCreateReminder ? params.dueDate : undefined,
          content: isCreateReminder ? params.reminderContent : undefined,
          ownerId: isCreateReminder ? params.ownerId : undefined,
          resetTrigger: isCreateReminder ? params.resetTrigger : undefined,
          periodDays: isCreateReminder
            ? parseOptionalNumberInput(params.periodDays, 'Period In Days', {
                integer: true,
                min: 1,
              })
            : undefined,
          cursor: isIn(CURSOR_OPERATIONS) ? params.cursor : undefined,
          limit: isIn(LIMIT_OPERATIONS)
            ? parseOptionalNumberInput(params.limit, 'Limit', { integer: true, min: 1 })
            : undefined,
          totalCount: isIn(TOTAL_COUNT_OPERATIONS)
            ? parseOptionalBooleanInput(params.totalCount)
            : undefined,
          fieldEntityType: undefined,
          noteEntityType: undefined,
          mergeEntityType: undefined,
          reminderEntityType: undefined,
          listName: undefined,
          listType: undefined,
          optionType: undefined,
          optionText: undefined,
          optionRank: undefined,
          optionColor: undefined,
          optionStatusCategory: undefined,
          optionWinRate: undefined,
          fieldValue: undefined,
          fieldUpdates: undefined,
          searchFilters: undefined,
          searchSorts: undefined,
          searchTermFieldIds: undefined,
          searchIds: undefined,
          scopeCompanyId: undefined,
          entityIds: undefined,
          valueFieldIds: undefined,
          valueFieldTypes: undefined,
          noteType: undefined,
          noteHtml: undefined,
          noteCompanyIds: undefined,
          notePersonIds: undefined,
          noteOpportunityIds: undefined,
          noteCreatedAt: undefined,
          reminderType: undefined,
          reminderContent: undefined,
          connectionFilter: undefined,
          relationshipOrderBy: undefined,
          changeOrderBy: undefined,
          noteIncludes: undefined,
          fieldIncludes: undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Affinity operation to perform' },
  },

  outputs: {
    companies: {
      type: 'json',
      description: 'Companies returned by a company list, search, or attachment read',
    },
    persons: { type: 'json', description: 'People returned by a person list, search, or read' },
    opportunities: { type: 'json', description: 'Opportunities returned by a list or read' },
    lists: { type: 'json', description: 'Lists returned by a list read' },
    listEntries: { type: 'json', description: 'List rows, each with its entity and field values' },
    savedViews: { type: 'json', description: 'Saved views on a list' },
    fields: {
      type: 'json',
      description: 'Field definitions from a metadata read, or field values from a value read',
    },
    options: { type: 'json', description: 'Dropdown options on a field' },
    notes: { type: 'json', description: 'Notes returned by a note or entity read' },
    replies: { type: 'json', description: 'Replies to a note' },
    calls: { type: 'json', description: 'Logged calls' },
    chatMessages: { type: 'json', description: 'Logged chat messages' },
    emails: { type: 'json', description: 'Email metadata. Bodies are never returned by the API' },
    meetings: { type: 'json', description: 'Meetings and their attendees' },
    transcripts: { type: 'json', description: 'Transcript metadata' },
    fragments: { type: 'json', description: 'Spoken segments of a transcript' },
    relationships: { type: 'json', description: 'Scored relationships between two people' },
    connections: { type: 'json', description: 'Inferred introductions, grouped by target' },
    reminders: { type: 'json', description: 'Reminders and their recurrence' },
    merges: { type: 'json', description: 'Company or person merges and their status' },
    tasks: { type: 'json', description: 'Merge tasks and their result summaries' },
    changes: { type: 'json', description: 'Field value changes, for delta sync' },
    users: { type: 'json', description: 'Internal users in the organization' },
    results: { type: 'json', description: 'Keyword-search matches with their previews' },
    count: { type: 'number', description: 'Number of rows on the returned page' },
    nextCursor: { type: 'string', description: 'Cursor for the next page, null on the last page' },
    prevCursor: {
      type: 'string',
      description: 'Cursor for the previous page, null on the first page',
    },
    totalCount: {
      type: 'number',
      description: 'Total size of the collection, only when Include Total Count was set',
    },
    id: { type: 'any', description: 'Identifier of the single record that was read or written' },
    name: { type: 'string', description: 'Name of a company, list, opportunity, or saved view' },
    domain: { type: 'string', description: 'Primary domain of a company' },
    domains: { type: 'json', description: 'Every domain on a company' },
    isGlobal: { type: 'boolean', description: 'Whether a company is an Affinity Data profile' },
    firstName: { type: 'string', description: 'First name of a person or user' },
    lastName: { type: 'string', description: 'Last name of a person or user' },
    primaryEmailAddress: { type: 'string', description: 'Primary email of a person or user' },
    emailAddresses: { type: 'json', description: 'Every email address on a person or user' },
    photoUrl: { type: 'string', description: "URL of a user's photo" },
    status: { type: 'string', description: 'Status of a user, reminder, or merge' },
    role: { type: 'string', description: 'Account role of a user' },
    type: {
      type: 'string',
      description: 'Kind of the returned record — list type, note type, field type, or option type',
    },
    listId: { type: 'number', description: 'List a row or opportunity belongs to' },
    listName: { type: 'string', description: 'Name of that list' },
    isRestricted: { type: 'boolean', description: 'Whether list permissions restrict access' },
    isRedacted: { type: 'boolean', description: 'Whether the returned fields were redacted' },
    creatorId: { type: 'number', description: 'User who created a list or added a row' },
    ownerId: { type: 'number', description: 'User who owns a list' },
    isPublic: { type: 'boolean', description: 'Whether a list is visible to the organization' },
    createdAt: { type: 'string', description: 'When the record was created' },
    updatedAt: { type: 'string', description: 'When the record was last updated' },
    entity: { type: 'json', description: 'The company, person, or opportunity on a list row' },
    content: { type: 'json', description: 'Body of a note, or text of a reminder' },
    creator: { type: 'json', description: 'Who authored the note or created the reminder' },
    mentions: { type: 'json', description: 'People mentioned in a note body' },
    repliesCount: { type: 'number', description: 'Number of replies on a root note' },
    parent: { type: 'json', description: 'Note being replied to' },
    interaction: { type: 'json', description: 'Interaction a note is anchored to' },
    transcriptId: { type: 'number', description: 'Transcript behind an AI Notetaker note' },
    personsPreview: { type: 'json', description: 'People attached to a note, with a count' },
    companiesPreview: { type: 'json', description: 'Companies attached to a note, with a count' },
    opportunitiesPreview: {
      type: 'json',
      description: 'Opportunities attached to a note, with a count',
    },
    note: { type: 'json', description: 'The AI Notetaker note a transcript belongs to' },
    languageCode: { type: 'string', description: 'Language a transcribed meeting was held in' },
    fragmentsPreview: { type: 'json', description: 'First 100 fragments of a transcript' },
    value: { type: 'json', description: 'A field value as {type, data}' },
    enrichmentSource: { type: 'string', description: 'Where an enriched field gets its data' },
    text: { type: 'string', description: 'Label of a dropdown option' },
    rank: { type: 'number', description: 'Sort order of a dropdown option' },
    color: { type: 'string', description: 'Color of a dropdown option' },
    statusCategory: { type: 'string', description: 'Pipeline meaning of a status option' },
    winRate: { type: 'number', description: 'Win rate of a status option' },
    dueDate: { type: 'string', description: 'When a reminder is due' },
    owner: { type: 'json', description: 'User a reminder is assigned to' },
    completer: { type: 'json', description: 'User who completed a reminder' },
    completedAt: { type: 'string', description: 'When a reminder was completed' },
    recurrence: { type: 'json', description: 'Recurrence of a reminder' },
    company: { type: 'json', description: 'Company tagged on a reminder' },
    person: { type: 'json', description: 'Person tagged on a reminder' },
    opportunity: { type: 'json', description: 'Opportunity tagged on a reminder' },
    taskId: { type: 'string', description: 'Task grouping a merge with its siblings' },
    taskUrl: { type: 'string', description: 'URL of the task a new merge runs under' },
    startedAt: { type: 'string', description: 'When a merge started' },
    errorMessage: { type: 'string', description: 'Why a merge failed' },
    primaryCompanyId: { type: 'number', description: 'Company kept by a company merge' },
    duplicateCompanyId: { type: 'number', description: 'Company folded in by a company merge' },
    primaryPersonId: { type: 'number', description: 'Person kept by a person merge' },
    duplicatePersonId: { type: 'number', description: 'Person folded in by a person merge' },
    resultsSummary: { type: 'json', description: 'Counts of the merges a task groups' },
    operation: { type: 'string', description: 'Batch operation Affinity performed' },
    success: { type: 'boolean', description: 'Whether a write with no response body was accepted' },
    entityType: { type: 'string', description: 'Entity kind a semantic search covered' },
    explanation: { type: 'string', description: 'How a semantic search read the prompt' },
    tenant: { type: 'json', description: 'Organization the API key belongs to' },
    user: { type: 'json', description: 'User the API key authenticates as' },
    grant: { type: 'json', description: 'Grant type and scopes behind the API key' },
  },
}

export const AffinityBlockMeta = {
  tags: ['sales-engagement', 'enrichment'],
  url: 'https://www.affinity.co',
  skills: [
    {
      name: 'sync-affinity-pipeline',
      description:
        'Page a deal list or saved view out of Affinity with the columns a report needs. Use to mirror pipeline into a table before analysis.',
      content:
        '# Sync Affinity Pipeline\n\nMirror a deal list into a table you can query.\n\n## Steps\n1. Find the list with List Lists, then read its columns with List List Fields and note the Field IDs the report needs.\n2. Page List List Entries with those Field IDs, following nextCursor until a page comes back without one.\n3. When the report should respect a view the team already curated, page List Saved View Entries instead — the view decides both the rows and the columns.\n4. Flatten each row: the entity name and ID, plus one column per requested field value.\n\n## Output\nReport how many rows were read and which fields were requested. Say explicitly when paging stopped early or a requested field was not on the list.',
    },
    {
      name: 'update-affinity-deal-stage',
      description:
        'Move a deal to a new stage by writing its list field. Use when a workflow decides a stage change and must record it.',
      content:
        '# Update Affinity Deal Stage\n\nWrite a stage change back onto the deal row.\n\n## Steps\n1. Read the list columns with List List Fields and find the status or stage field.\n2. Read its options with List List Field Dropdown Options and match the target stage by text to get the option ID.\n3. Write the row with Update List Entry Field, passing {"type":"ranked-dropdown","data":{"dropdownOptionId":<id>}} — or the plain dropdown shape when the field is not ranked.\n4. When several columns move together, send them in one Batch Update List Entry Fields call instead.\n\n## Output\nReport the row, the field, and the option written. Stop and say so when the stage name matches no existing option — never invent an option ID.',
    },
    {
      name: 'enrich-affinity-company',
      description:
        'Fill in what Affinity knows about a company and write missing values back. Use before scoring or routing an account.',
      content:
        "# Enrich Affinity Company\n\nPull the full picture of a company and close the gaps.\n\n## Steps\n1. Resolve the company — Search Companies on a name or domain, or Semantic Search when only a description is available.\n2. Read the enriched and global fields with List Entity Field Values on that company.\n3. Write anything the record is missing with Update Entity Field Value, matching the field's declared value type.\n4. Add the lists the company already sits on with List Lists Holding Entity so the context travels with the record.\n\n## Output\nReport the company matched, the fields already populated, and the fields written. Flag a name that matched more than one company rather than picking one.",
    },
    {
      name: 'find-warm-intro',
      description:
        'Find who can introduce you into a target company, through relationship strength, shared work history, or investment history. Use before cold outreach.',
      content:
        '# Find Warm Intro\n\nFind the shortest real path into a company.\n\n## Steps\n1. Resolve the target company to its ID with Search Companies.\n2. Read List Entity Relationships on that company and keep the pairs with the highest interaction score — these are the paths that already exist.\n3. Read List Coworker Connections filtered to target.currentCompany.id for people who once worked alongside the targets.\n4. Read List Investor Executive Connections for paths through investors who backed a company a target once led.\n5. Rank the paths by strength and name the specific person who should make each introduction.\n\n## Output\nReport each path as introducer, target, and why the link exists. Say plainly when no path clears a useful threshold instead of surfacing weak ones.',
    },
    {
      name: 'log-affinity-meeting-note',
      description:
        'Write a meeting summary into Affinity as a note attached to the right records. Use after a call or meeting.',
      content:
        '# Log Affinity Meeting Note\n\nPut a summary where the deal team will find it.\n\n## Steps\n1. Find the interaction with List Meetings or List Calls, filtered to the window and the attendees.\n2. When the meeting has an AI Notetaker transcript, read it with List Transcript Fragments and summarize what was actually said.\n3. Write the note with Create Note as an interaction note anchored to that meeting or call, attaching the companies, people, and opportunities it concerns.\n4. Reply to an existing thread with a user-reply note instead of a new root note when the summary continues a conversation.\n\n## Output\nReport the note created, the interaction it is anchored to, and the records attached. Say so when no matching interaction was found and the note was attached to records only.',
    },
    {
      name: 'affinity-followup-reminders',
      description:
        'Create reminders on deals that have gone quiet, and report the ones already overdue. Use for pipeline hygiene.',
      content:
        '# Affinity Follow-up Reminders\n\nStop deals from going silent.\n\n## Steps\n1. Read the pipeline rows with List List Entries, including the last-interaction field the list exposes.\n2. Read List Reminders filtered to overdue and match them against those rows so nothing is double-booked.\n3. For a row past the staleness threshold with no live reminder, call Create Reminder against the company, person, or opportunity with a due date and a specific next step.\n4. Use a recurring reminder with an interaction reset trigger when the deal needs standing attention rather than one nudge.\n\n## Output\nReport the reminders created and the ones already overdue. Name the deals that were skipped and why.',
    },
    {
      name: 'affinity-delta-sync',
      description:
        'Read only what changed in Affinity since the last run and apply it to a mirror. Use to keep a warehouse or table in step.',
      content:
        '# Affinity Delta Sync\n\nMove only the changes.\n\n## Steps\n1. Start from the cursor the previous run stored. On a first run, start from a filter on changedAt instead.\n2. Page List Field Value Changes ordered oldest first, following nextCursor until a page returns none.\n3. Apply each change to the mirror by its action type: add, update, or delete. A change carrying a list entry belongs to that row, not to the entity as a whole.\n4. Store the last cursor as the watermark for the next run, and store it only after the whole page applied.\n\n## Output\nReport how many changes were read and applied, and the cursor to resume from. Say explicitly when the run stopped part way and the watermark was not advanced.',
    },
  ],
  templates: [
    {
      icon: AffinityIcon,
      title: 'Affinity pipeline digest',
      prompt:
        'Build a workflow that runs every Monday, pages my Affinity deal list for every row with its stage, owner, and last interaction date, and posts a Slack summary of what moved, what is stalled, and what is closing this month.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity meeting note logger',
      prompt:
        'Create a workflow that finds yesterday’s Affinity meetings, reads the transcript of each one, writes a short summary as a note anchored to that meeting, and attaches it to the company and people who attended.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'meeting', 'automation'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity warm intro finder',
      prompt:
        'Build an agent that takes a target company name, resolves it in Affinity, and reports who on my team can make an introduction — ranking relationships by interaction score and adding coworker and investor paths into the same company.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'crm'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity deal stage sync',
      prompt:
        'Create a workflow that watches a table of deal decisions, looks up the matching Affinity list row, resolves the stage name to its dropdown option, and writes the new stage onto the row.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['crm', 'automation'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity company enrichment',
      prompt:
        'Build a workflow that takes new companies from my accounts table, searches Affinity for each one, reads its enriched fields, and writes headcount, location, and category back onto both the Affinity record and the table row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'enrichment', 'automation'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity stale deal reminders',
      prompt:
        'Create a scheduled workflow that finds Affinity deals with no interaction in 30 days, creates a follow-up reminder on each one with a specific next step, and emails the owner a list of what went quiet.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['crm', 'automation', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity semantic sourcing',
      prompt:
        'Build an agent that takes an investment thesis in plain language, runs a semantic search across my Affinity companies, and writes the best matches to a table with why each one fits and which list it already sits on.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'finance', 'crm'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity data room search',
      prompt:
        'Create a workflow that takes a diligence question, searches the notes and files attached to a company in Affinity, and answers with the passages it found and the note or file each one came from.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'knowledge-base'],
    },
    {
      icon: AffinityIcon,
      title: 'Affinity warehouse delta sync',
      prompt:
        'Build a scheduled workflow that reads the Affinity field value change feed from the cursor it stored last run, applies every add, update, and delete to my table mirror, and saves the new cursor only after the whole page applied.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'engineering',
      tags: ['crm', 'automation', 'data-analytics'],
    },
  ],
} as const satisfies BlockMeta
