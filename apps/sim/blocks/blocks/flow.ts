import { FlowIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const FlowBlock: BlockConfig = {
  type: 'flow',
  name: 'Flow Engineering',
  description: 'Manage engineering requirements and traceability',
  longDescription:
    'Read and update Flow Engineering projects, requirements, tests, and other entities through its customer API. Search current project data, inspect categories and relationships, manage comments, and make controlled changes on a working branch using your connected account permissions.',
  docsLink: 'https://docs.sim.ai/integrations/flow',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: FlowIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Flow Engineering',
    sentences: {
      byOperation: {
        list_projects: ['List Projects'],
        get_project: [
          {
            text: 'Read project',
            field: ['projectSelector', 'projectId'],
            core: true,
          },
        ],
        get_data_model: [
          {
            text: 'Read data model of',
            field: ['projectSelector', 'projectId'],
            core: true,
          },
        ],
        list_branches: ['List Branches'],
        create_branch: ['Create Branch'],
        search_entities: [
          {
            text: 'Search entities for',
            field: 'query',
            core: true,
          },
        ],
        list_entities: ['List Entities'],
        get_entities: [
          {
            text: 'Read entities',
            field: 'entityIds',
            core: true,
          },
        ],
        create_entity: [
          {
            text: 'Create entity',
            field: 'name',
            core: true,
          },
        ],
        create_entities: ['Create Entities'],
        set_value: [
          {
            text: 'Set field',
            field: 'fieldKey',
            core: true,
          },
          {
            text: 'on',
            field: 'entityId',
            core: true,
          },
        ],
        set_values: ['Set Values'],
        delete_entity: [
          {
            text: 'Delete entity',
            field: 'entityId',
            core: true,
          },
        ],
        restore_entity: [
          {
            text: 'Restore entity',
            field: 'entityId',
            core: true,
          },
        ],
        add_link: [
          {
            text: 'Link entity',
            field: 'entityId',
            core: true,
          },
          {
            text: 'to',
            field: 'destinationId',
            core: true,
          },
        ],
        remove_link: [
          {
            text: 'Unlink entity',
            field: 'entityId',
            core: true,
          },
          {
            text: 'from',
            field: 'destinationId',
            core: true,
          },
        ],
        list_comments: [
          {
            text: 'Read comments on',
            field: 'entityId',
            core: true,
          },
        ],
        get_comment: [
          {
            text: 'Read comment',
            field: 'commentId',
            core: true,
          },
        ],
        create_comment: [
          {
            text: 'Post comment',
            field: 'text',
            core: true,
          },
          {
            text: 'on',
            field: 'entityId',
            core: true,
          },
        ],
        update_comment: [
          {
            text: 'Update comment',
            field: 'commentId',
            core: true,
          },
        ],
        delete_comment: [
          {
            text: 'Delete comment',
            field: 'commentId',
            core: true,
          },
        ],
        filter_entities: ['Filter Entities'],
        get_entity_history: [
          {
            text: 'Read history of',
            field: 'entityIds',
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      value: () => 'search_entities',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          label: 'List Projects',
          id: 'list_projects',
        },
        {
          label: 'Get Project',
          id: 'get_project',
        },
        {
          label: 'Get Data Model',
          id: 'get_data_model',
        },
        {
          label: 'List Branches',
          id: 'list_branches',
        },
        {
          label: 'Create Branch',
          id: 'create_branch',
        },
        {
          label: 'Search Entities',
          id: 'search_entities',
        },
        {
          label: 'List Entities',
          id: 'list_entities',
        },
        {
          label: 'Get Entities',
          id: 'get_entities',
        },
        {
          label: 'Create Entity',
          id: 'create_entity',
        },
        {
          label: 'Create Entities',
          id: 'create_entities',
        },
        {
          label: 'Set Value',
          id: 'set_value',
        },
        {
          label: 'Set Values',
          id: 'set_values',
        },
        {
          label: 'Delete Entity',
          id: 'delete_entity',
        },
        {
          label: 'Restore Entity',
          id: 'restore_entity',
        },
        {
          label: 'Add Link',
          id: 'add_link',
        },
        {
          label: 'Remove Link',
          id: 'remove_link',
        },
        {
          label: 'List Comments',
          id: 'list_comments',
        },
        {
          label: 'Get Comment',
          id: 'get_comment',
        },
        {
          label: 'Create Comment',
          id: 'create_comment',
        },
        {
          label: 'Update Comment',
          id: 'update_comment',
        },
        {
          label: 'Delete Comment',
          id: 'delete_comment',
        },
        {
          label: 'Filter Entities',
          id: 'filter_entities',
        },
        {
          label: 'Get Entity History',
          id: 'get_entity_history',
        },
      ],
    },
    {
      id: 'credential',
      title: 'Flow Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'flow',
      credentialKind: 'service-account',
      required: true,
    },
    {
      id: 'projectSelector',
      title: 'Project',
      type: 'dropdown',
      canonicalParamId: 'projectId',
      mode: 'basic',
      placeholder: 'Select project',
      condition: {
        field: 'operation',
        value: [
          'get_project',
          'get_data_model',
          'list_branches',
          'create_branch',
          'search_entities',
          'list_entities',
          'get_entities',
          'create_entity',
          'create_entities',
          'set_value',
          'set_values',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'get_comment',
          'create_comment',
          'update_comment',
          'delete_comment',
          'filter_entities',
          'get_entity_history',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_project',
          'get_data_model',
          'list_branches',
          'create_branch',
          'search_entities',
          'list_entities',
          'get_entities',
          'create_entity',
          'create_entities',
          'set_value',
          'set_values',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'get_comment',
          'create_comment',
          'update_comment',
          'delete_comment',
          'filter_entities',
          'get_entity_history',
        ],
      },
      selectorKey: 'flow.projects',
      dependsOn: ['credential'],
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      canonicalParamId: 'projectId',
      mode: 'advanced',
      placeholder: 'Enter project ID',
      condition: {
        field: 'operation',
        value: [
          'get_project',
          'get_data_model',
          'list_branches',
          'create_branch',
          'search_entities',
          'list_entities',
          'get_entities',
          'create_entity',
          'create_entities',
          'set_value',
          'set_values',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'get_comment',
          'create_comment',
          'update_comment',
          'delete_comment',
          'filter_entities',
          'get_entity_history',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_project',
          'get_data_model',
          'list_branches',
          'create_branch',
          'search_entities',
          'list_entities',
          'get_entities',
          'create_entity',
          'create_entities',
          'set_value',
          'set_values',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'get_comment',
          'create_comment',
          'update_comment',
          'delete_comment',
          'filter_entities',
          'get_entity_history',
        ],
      },
      dependsOn: ['credential'],
    },
    {
      id: 'categorySelector',
      title: 'Category',
      type: 'dropdown',
      canonicalParamId: 'entityType',
      mode: 'basic',
      placeholder: 'Select category',
      condition: {
        field: 'operation',
        value: ['search_entities', 'list_entities', 'create_entity'],
      },
      required: {
        field: 'operation',
        value: ['create_entity'],
      },
      selectorKey: 'flow.categories',
      dependsOn: ['credential', 'projectId'],
    },
    {
      id: 'entityType',
      title: 'Category ID',
      type: 'short-input',
      canonicalParamId: 'entityType',
      mode: 'advanced',
      placeholder: 'Enter category ID',
      condition: {
        field: 'operation',
        value: ['search_entities', 'list_entities', 'create_entity'],
      },
      required: {
        field: 'operation',
        value: ['create_entity'],
      },
      dependsOn: ['credential', 'projectId'],
    },
    {
      id: 'branchSelector',
      title: 'Branch',
      type: 'dropdown',
      canonicalParamId: 'branchId',
      mode: 'basic',
      placeholder: 'Select branch (defaults to Base)',
      condition: {
        field: 'operation',
        value: [
          'search_entities',
          'list_entities',
          'get_entities',
          'create_entity',
          'create_entities',
          'set_value',
          'set_values',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'create_comment',
          'filter_entities',
          'get_entity_history',
        ],
      },
      required: false,
      selectorKey: 'flow.branches',
      dependsOn: ['credential', 'projectId'],
    },
    {
      id: 'branchId',
      title: 'Branch ID',
      type: 'short-input',
      canonicalParamId: 'branchId',
      mode: 'advanced',
      placeholder: 'master (Base) or branch ID',
      condition: {
        field: 'operation',
        value: [
          'search_entities',
          'list_entities',
          'get_entities',
          'create_entity',
          'create_entities',
          'set_value',
          'set_values',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'create_comment',
          'filter_entities',
          'get_entity_history',
        ],
      },
      required: false,
      dependsOn: ['credential', 'projectId'],
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'list_projects',
          'search_entities',
          'list_entities',
          'filter_entities',
          'get_entity_history',
        ],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Defaults to the operation page size',
    },
    {
      id: 'branchName',
      title: 'Branch Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['create_branch'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter branch name',
    },
    {
      id: 'parentId',
      title: 'Parent Branch ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['create_branch'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'master (Base) or parent branch ID',
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: ['create_branch'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter branch description',
    },
    {
      id: 'isVariant',
      title: 'Variant',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['create_branch'],
      },
      required: false,
      mode: 'advanced',
      options: [
        {
          label: 'Yes',
          id: 'true',
        },
        {
          label: 'No',
          id: 'false',
        },
      ],
    },
    {
      id: 'query',
      title: 'Query',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['search_entities'],
      },
      required: {
        field: 'operation',
        value: ['search_entities'],
      },
      placeholder: 'Search text or exact Flow ID',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['list_entities', 'filter_entities', 'get_entity_history'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'Enter cursor from the previous page',
    },
    {
      id: 'entityIds',
      title: 'Entity IDs',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_entities', 'get_entity_history'],
      },
      required: {
        field: 'operation',
        value: ['get_entities', 'get_entity_history'],
      },
      placeholder: 'entity-id-1, entity-id-2',
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['create_entity'],
      },
      required: {
        field: 'operation',
        value: ['create_entity'],
      },
      placeholder: 'Enter entity name',
    },
    {
      id: 'entities',
      title: 'Entities',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['create_entities'],
      },
      required: {
        field: 'operation',
        value: ['create_entities'],
      },
      placeholder: '[{"entityType":"category-id","name":"Operating temperature"}]',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Generate valid JSON for Flow entities: Array of 1\u2013100 entities: [{entityType, name, id?}]. IDs may be omitted for server generation. Return only JSON. Use only supplied category IDs and field keys.',
        placeholder: 'Describe the entities to generate',
      },
    },
    {
      id: 'entityId',
      title: 'Entity ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: [
          'set_value',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'get_comment',
          'create_comment',
          'update_comment',
          'delete_comment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'set_value',
          'delete_entity',
          'restore_entity',
          'add_link',
          'remove_link',
          'list_comments',
          'get_comment',
          'create_comment',
          'update_comment',
          'delete_comment',
        ],
      },
      placeholder: 'Enter entity or original comment ID',
    },
    {
      id: 'fieldKey',
      title: 'Field Key',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['set_value'],
      },
      required: {
        field: 'operation',
        value: ['set_value'],
      },
      placeholder: 'name',
    },
    {
      id: 'value',
      title: 'Value',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['set_value'],
      },
      required: {
        field: 'operation',
        value: ['set_value'],
      },
      placeholder: '"Updated name"',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-value',
        prompt:
          'Generate valid JSON for Flow value: Field value as JSON, matching the data model: string, number, boolean, array, object, or null. Use only supplied category IDs and field keys. Return ONLY one raw JSON value, without markdown fences or prose.',
        placeholder: 'Describe the value to generate',
      },
    },
    {
      id: 'updates',
      title: 'Updates',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['set_values'],
      },
      required: {
        field: 'operation',
        value: ['set_values'],
      },
      placeholder: '[{"entityId":"entity-id","key":"name","value":"Operating range"}]',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt:
          'Generate valid JSON for Flow updates: Array of 1\u2013100 field updates: [{entityId, key, value}]. Return only JSON. Use only supplied category IDs and field keys.',
        placeholder: 'Describe the updates to generate',
      },
    },
    {
      id: 'destinationId',
      title: 'Destination ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['add_link', 'remove_link'],
      },
      required: {
        field: 'operation',
        value: ['add_link', 'remove_link'],
      },
      placeholder: 'Enter downstream entity ID',
    },
    {
      id: 'includeResolved',
      title: 'Include Resolved',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['list_comments'],
      },
      required: false,
      mode: 'advanced',
      options: [
        {
          label: 'Yes',
          id: 'true',
        },
        {
          label: 'No',
          id: 'false',
        },
      ],
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['get_comment', 'update_comment', 'delete_comment'],
      },
      required: {
        field: 'operation',
        value: ['get_comment', 'update_comment', 'delete_comment'],
      },
      placeholder: 'Enter comment ID',
    },
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      condition: {
        field: 'operation',
        value: ['create_comment', 'update_comment'],
      },
      required: {
        field: 'operation',
        value: ['create_comment'],
      },
      placeholder: 'Enter comment text',
    },
    {
      id: 'resolved',
      title: 'Resolved',
      type: 'dropdown',
      condition: {
        field: 'operation',
        value: ['update_comment'],
      },
      required: false,
      mode: 'advanced',
      options: [
        {
          label: 'Yes',
          id: 'true',
        },
        {
          label: 'No',
          id: 'false',
        },
      ],
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['filter_entities'],
      },
      required: {
        field: 'operation',
        value: ['filter_entities'],
      },
      placeholder:
        '{"kind":"field","category_id":"category-id","field_key":"name","operation":"contains","value":"temperature"}',
      language: 'json',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt:
          'Generate valid JSON for Flow filter: Filter object: {kind:"type",operation:"overlaps",values:[categoryId]}, {kind:"field",category_id,field_key,operation:"contains",value}, or {kind:"group",operator:"and"|"or",conditions:[...]}. Use data-model IDs and field-compatible operators; at most 50 nodes and 5 group levels. Return only JSON. Use only supplied category IDs and field keys.',
        placeholder: 'Describe the filter to generate',
      },
    },
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      condition: {
        field: 'operation',
        value: ['filter_entities'],
      },
      required: false,
      mode: 'advanced',
      placeholder: 'UTC',
    },
  ],
  tools: {
    access: [
      'flow_list_projects',
      'flow_get_project',
      'flow_get_data_model',
      'flow_list_branches',
      'flow_create_branch',
      'flow_search_entities',
      'flow_list_entities',
      'flow_get_entities',
      'flow_create_entity',
      'flow_create_entities',
      'flow_set_value',
      'flow_set_values',
      'flow_delete_entity',
      'flow_restore_entity',
      'flow_add_link',
      'flow_remove_link',
      'flow_list_comments',
      'flow_get_comment',
      'flow_create_comment',
      'flow_update_comment',
      'flow_delete_comment',
      'flow_filter_entities',
      'flow_get_entity_history',
    ],
    config: {
      tool: (params) => `flow_${params.operation || 'search_entities'}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        result.limit =
          params.limit == null || (typeof params.limit === 'string' && !params.limit.trim())
            ? undefined
            : Number(params.limit)
        for (const key of ['includeResolved', 'resolved', 'isVariant']) {
          result[key] =
            params[key] == null || params[key] === ''
              ? undefined
              : params[key] === true || params[key] === 'true'
        }
        return result
      },
    },
  },
  inputs: {
    operation: {
      type: 'string',
      description: 'Operation to perform',
    },
    oauthCredential: {
      type: 'string',
      description: 'Saved Flow personal API key credential',
    },
    limit: {
      type: 'number',
      description: 'Maximum results in this page',
    },
    projectId: {
      type: 'string',
      description: 'Project UUID returned by List Projects',
    },
    branchName: {
      type: 'string',
      description: 'Name of the new branch',
    },
    parentId: {
      type: 'string',
      description: 'Parent branch ID; omit for Base',
    },
    description: {
      type: 'string',
      description: 'Description of the new branch',
    },
    isVariant: {
      type: 'boolean',
      description: 'Create a variant branch',
    },
    branchId: {
      type: 'string',
      description: 'Branch ID; omit or use master for Base',
    },
    entityType: {
      type: 'string',
      description: 'Category ID returned by Get Data Model',
    },
    query: {
      type: 'string',
      description:
        'Search names and supported field values, or an exact Flow/Human ID; at most 1024 characters',
    },
    cursor: {
      type: 'string',
      description: 'Opaque continuation cursor from the previous page',
    },
    entityIds: {
      type: 'string',
      description: 'Comma-separated entity IDs; up to 100 per read or 500 per history page',
    },
    name: {
      type: 'string',
      description: 'Entity name',
    },
    entities: {
      type: 'json',
      description:
        'Array of 1\u2013100 entities: [{entityType, name, id?}]. IDs may be omitted for server generation',
    },
    entityId: {
      type: 'string',
      description: 'Entity ID, or the original comment ID when reading or posting thread replies',
    },
    fieldKey: {
      type: 'string',
      description: 'Stored field key returned by Get Data Model',
    },
    value: {
      type: 'string',
      description:
        'Field value as JSON, matching the data model: string, number, boolean, array, object, or null',
    },
    updates: {
      type: 'json',
      description: 'Array of 1\u2013100 field updates: [{entityId, key, value}]',
    },
    destinationId: {
      type: 'string',
      description: 'ID of the downstream entity to link or unlink',
    },
    includeResolved: {
      type: 'boolean',
      description: 'Include resolved comments',
    },
    commentId: {
      type: 'string',
      description: "Comment ID; entityId must be the comment's returned entity_id",
    },
    text: {
      type: 'string',
      description: 'Replacement plain-text comment body',
    },
    resolved: {
      type: 'boolean',
      description: 'Resolve the thread with true or reopen it with false',
    },
    filter: {
      type: 'json',
      description:
        'Filter object: {kind:"type",operation:"overlaps",values:[categoryId]}, {kind:"field",category_id,field_key,operation:"contains",value}, or {kind:"group",operator:"and"|"or",conditions:[...]}. Use data-model IDs and field-compatible operators; at most 50 nodes and 5 group levels',
    },
    timezone: {
      type: 'string',
      description: 'IANA timezone for date filters; defaults to UTC',
    },
  },
  outputs: {
    projects: {
      type: 'json',
      description: 'Projects (id, name, slug, created_at, ai_model)',
    },
    project: {
      type: 'json',
      description: 'Project (id, name, slug, created_at, ai_model)',
    },
    categories: {
      type: 'json',
      description: 'Categories (id, name, categoryType, fields with key, name, type and tags)',
    },
    branches: {
      type: 'json',
      description: 'Branches (id, name, number, parent, protection and review state)',
    },
    matches: {
      type: 'json',
      description:
        'Compact search matches (entity_id, name, entity_type, human_id, legacy_human_id)',
    },
    entities: {
      type: 'json',
      description: 'Entity states (id, type, values, formulas, links, timestamps)',
    },
    entity: {
      type: 'json',
      description: 'Entity state (id, type, values, formulas, links, timestamps)',
    },
    comments: {
      type: 'json',
      description: 'Comments (id, entity_id, author_id, text, resolved, created_at, branch_id)',
    },
    comment: {
      type: 'json',
      description: 'Comment (id, entity_id, author_id, text, resolved, created_at, branch_id)',
    },
    entries: {
      type: 'json',
      description: 'History entries (id, timestamp, branch_id, actor, change, reason)',
    },
    entityIds: {
      type: 'json',
      description: 'Entity IDs returned by Filter Entities',
    },
    nextCursor: {
      type: 'string',
      description: 'History or filter cursor; null when finished',
    },
    nextPageStart: {
      type: 'string',
      description: 'Entity listing cursor for the next page',
    },
    moreAvailable: {
      type: 'boolean',
      description: 'Whether to fetch the next entity page',
    },
    id: {
      type: 'string',
      description: 'Created branch ID',
    },
    number: {
      type: 'number',
      description: 'Created branch number',
    },
  },
}

export const FlowBlockMeta = {
  tags: ['project-management', 'automation', 'version-control'],
  url: 'https://www.flowengineering.com',
  templates: [
    {
      icon: FlowIcon,
      title: 'Flow requirement lookup',
      prompt:
        'When asked about a component, search its Flow project, read the matching entities, and summarize requirements with their IDs.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
    {
      icon: FlowIcon,
      title: 'Flow traceability review',
      prompt:
        'Read the Flow data model and selected requirements, follow their links, and report missing test coverage without changing the project.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
    {
      icon: FlowIcon,
      title: 'Flow requirement drafts',
      prompt:
        'On request, create a working branch in Flow, draft requirements in a selected category, and set their fields using the project data model.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
    {
      icon: FlowIcon,
      title: 'Flow review digest',
      prompt:
        'On a schedule, list Flow project branches and summarize the branches ready for review and their unresolved discussion threads.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
    {
      icon: FlowIcon,
      title: 'Flow field update',
      prompt:
        'From a supplied change list, read the current Flow entity values, apply the approved field updates as one batch, and report the changed IDs.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
    {
      icon: FlowIcon,
      title: 'Flow discussion summary',
      prompt:
        'When given a Flow entity, read its comment threads and their direct replies, summarize open decisions, and post a follow-up only when requested.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
    {
      icon: FlowIcon,
      title: 'Flow change history',
      prompt:
        'When investigating a requirement change, read its paginated Flow history on the selected branch and explain the actors, changes, and timestamps.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['project-management'],
    },
  ],
  skills: [
    {
      name: 'find-engineering-requirements',
      description: 'Find current requirements using project-aware search.',
      content:
        '# Find Engineering Requirements\n\n## Steps\n1. List accessible projects and select the requested project.\n2. Read its data model to identify the requirement category.\n3. Search entities on the requested branch.\n4. Read matching entity IDs for complete values and links.\n\n## Output\nSummarize the requirements with IDs and the selected branch. A search is bounded; do not claim it exports every requirement.',
    },
    {
      name: 'review-requirement-traceability',
      description: 'Inspect links between requirements and verification artifacts.',
      content:
        '# Review Requirement Traceability\n\n## Steps\n1. Read the project data model and selected requirements.\n2. Inspect their inbound and outbound links.\n3. Read linked entities on the same branch.\n4. Identify requirements without linked verification artifacts using the project categories.\n\n## Output\nReport observed coverage and missing links. Distinguish missing evidence from a failed verification.',
    },
    {
      name: 'draft-requirements-on-a-branch',
      description: 'Create proposed requirements on a working branch.',
      content:
        '# Draft Requirements On A Branch\n\n## Steps\n1. Read the project data model and existing requirements.\n2. Create a working branch.\n3. After the user approves the proposal, create the entities with documented category IDs.\n4. Set their field values on the same branch and read back the result.\n\n## Output\nReturn the branch and entity IDs for review. Do not claim the branch is merged.',
    },
    {
      name: 'summarize-engineering-discussions',
      description: 'Summarize an item discussion and its direct replies.',
      content:
        '# Summarize Engineering Discussions\n\n## Steps\n1. List comments on the selected entity and branch.\n2. Read each original comment ID to fetch direct replies.\n3. Separate open decisions from resolved threads.\n4. If a reply is requested, post to the original comment ID on the same branch.\n\n## Output\nProvide a concise summary tied to comment IDs and the relevant requirement.',
    },
    {
      name: 'audit-requirement-changes',
      description: 'Trace engineering changes through the documented history API.',
      content:
        '# Audit Requirement Changes\n\n## Steps\n1. Identify the project, branch, and entity IDs.\n2. Read history pages, preserving the same scope and passing each nextCursor.\n3. If a rebase invalidates the cursor, restart from the first page.\n4. Correlate changes with the current entity values.\n\n## Output\nReport actors, timestamps, and field or relationship changes without treating a partial history page as complete.',
    },
  ],
} as const satisfies BlockMeta
