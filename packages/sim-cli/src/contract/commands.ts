import type { CliContract, ColumnSpec, CommandVariantSpec } from './types'

const TABLE_NAME_HELP = 'Identifier: letters, numbers, and underscores; cannot start with a number'
const TABLE_FILTER_HELP =
  'Predicate: {"all":[{"field":"status","op":"eq","value":"active"}]}; groups use all/any. Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, like, ilike, nlike, nilike, isEmpty, isNotEmpty, isNull, isNotNull'
const TABLE_READ_FILTER_HELP =
  'Condition: {"field":"status","op":"eq","value":"active"}. Groups: {"all":[{"field":"status","op":"eq","value":"active"}]} or {"any":[{"field":"status","op":"eq","value":"active"}]}; group entries may also be nested groups. Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, like, ilike, nlike, nilike, isEmpty, isNotEmpty, isNull, isNotNull'
const TABLE_SORT_HELP =
  'Ordered sort keys: [{"field":"createdAt","direction":"desc"}] (direction: asc or desc)'
const CUSTOM_TOOL_SCHEMA_HELP =
  'OpenAI function schema: {"type":"function","function":{"name":"...","parameters":{"type":"object","properties":{}}}}'
/**
 * Every folder-path input the API accepts.
 *
 * `folderPath` is what marks the field for per-segment encoding, so a folder is
 * typed by the name the app shows it under. It belongs on the shared constant
 * rather than on each of the thirty-odd fields, because one that was missed
 * would silently be the only place `/Folder 1` is still rejected.
 */
const FOLDER_PATH_INPUT = {
  describe: 'Folder path as shown in the app; the leading / is optional',
  folderPath: true,
} as const
const FOLDER_PATH_FLAG = {
  ...FOLDER_PATH_INPUT,
  name: 'folder',
} as const
const FOLDER_DELETE_FLAGS = {
  path: FOLDER_PATH_INPUT,
  recursive: { boolean: true, describe: 'Delete the folder and its descendants' },
} as const
const KNOWLEDGE_BASE_PATH_ARGUMENT = { id: 'knowledgeBaseId' } as const
const WORKFLOW_RUN_SCOPE = {
  id: {
    name: 'workflow',
    placeholder: 'workflowId',
    describe: 'Workflow ID',
  },
} as const
const FOLDER_COLUMN: ColumnSpec = { header: 'folder', path: 'folderPath', format: 'folder-path' }
const FOLDER_LIST_COLUMNS: ColumnSpec[] = [
  { header: 'path', format: 'folder-path' },
  { header: 'name' },
  { header: 'parent', path: 'parentPath', format: 'folder-path' },
  { header: 'updated', path: 'updatedAt', format: 'timestamp' },
]

function moveResource(command: string, resource: string): CommandVariantSpec {
  return {
    command,
    positionals: ['folderPath'],
    requestFields: ['folderPath'],
    describe: `Move a ${resource} to a folder`,
  }
}

/**
 * The CLI contract for the v2 surface.
 *
 * Read this as a diff against what is already derivable — an operation absent
 * from this table still gets a command, built entirely from the generated
 * operation table. Only the entries below needed a human.
 *
 * Derived by default:
 *   listTables            → sim tables list
 *   getKnowledgeDocument  → sim knowledge documents get <knowledgeBaseId> <documentId>
 *   upsertTableRow        → sim tables upsert <tableId>
 */
export const CLI_CONTRACT: CliContract = {
  createCredentialConnection: { hidden: true },
  createServiceAccountCredential: { hidden: true },
  getBillingStatus: {
    command: 'billing status',
    allWorkspaces: true,
    describe: 'Show billing status and current-period credit usage',
    fields: [
      { header: 'plan' },
      { header: 'status' },
      { header: 'workspace', path: 'workspaceId' },
      { header: 'period start', path: 'period.start', format: 'timestamp' },
      { header: 'period end', path: 'period.end', format: 'timestamp' },
      { header: 'used credits', path: 'credits.used' },
      { header: 'limit credits', path: 'credits.limit' },
      { header: 'remaining credits', path: 'credits.remaining' },
    ],
  },
  listBillingLogs: {
    command: 'billing logs',
    allWorkspaces: true,
    describe: 'List credit usage events',
    flags: {
      source: { describe: 'Filter by usage source; sim-chat combines Copilot and workspace chat' },
      period: { describe: 'Billing period' },
      startDate: { describe: 'Custom period start (ISO 8601)' },
      endDate: { describe: 'Custom period end (ISO 8601)' },
    },
    columns: [
      { header: 'at', path: 'createdAt', format: 'timestamp' },
      { header: 'workspace', path: 'workspaceId' },
      { header: 'source' },
      { header: 'workflow', path: 'workflow.name' },
      { header: 'credits', path: 'creditCost' },
      { header: 'run', path: 'runId' },
      { header: 'id' },
    ],
  },

  // ─── Name collisions: REST overloads one path for single and bulk ─────────
  // The derived name is identical for both, so the bulk form is renamed. AWS's
  // `batch-` prefix rather than a `--all` flag: the plural is a different and
  // more dangerous operation, and it should be a different word.
  deleteTableRows: {
    command: 'tables rows batch-delete',
    describe: 'Delete rows matching a filter, or an explicit list of ids',
    flags: {
      rowIds: { name: 'row', list: true },
      filter: { json: true, describe: TABLE_FILTER_HELP },
    },
    confirm: 'This deletes every matching row and cannot be undone.',
  },
  updateRowsByFilter: {
    command: 'tables rows batch-update',
    describe: 'Update every row matching a filter',
    flags: {
      filter: { json: true, describe: TABLE_FILTER_HELP },
      data: { json: true },
    },
    confirm: 'This updates every matching row and cannot be undone.',
  },
  // Same overload one level down: PATCH `/documents` is the bulk form of PATCH
  // `/documents/[documentId]`. Both derived to `knowledge documents update`, and
  // because commander resolves a duplicate name to the first registered match,
  // the bulk form silently shadowed the single-document one — its flags were
  // unreachable from the terminal.
  bulkUpdateKnowledgeDocuments: {
    command: 'knowledge documents batch-update',
    describe: 'Enable or disable every matching document',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    flags: {
      documentIds: { name: 'document', list: true },
      selectAll: { boolean: true, describe: 'Apply to every document in the knowledge base' },
    },
  },
  listKnowledgeConnectorDocuments: {
    command: 'knowledge connectors documents list',
  },
  updateKnowledgeConnectorDocuments: {
    command: 'knowledge connectors documents update',
    flags: {
      documentIds: { name: 'document', list: true },
    },
  },
  // `DELETE /workflows/[id]/deploy` is an undeploy, not a delete.
  undeployWorkflow: {
    command: 'workflows undeploy',
    describe: 'Take a workflow out of deployment',
  },
  // `GET /workflows/[id]/deployment` is a collection-shaped path holding one
  // record, so the derived `list` promised a page of deployments there is no
  // such thing as. `status` is what the singular group beside `versions` can be
  // asked for.
  getWorkflowDeployment: {
    command: 'workflows deployment status',
    renamedFrom: ['workflows deployment list'],
    describe: 'Show a workflow’s current deployment',
  },
  setSecret: { hidden: true },

  // ─── Destructive single-resource operations ───────────────────────────────
  deleteTable: { confirm: 'This deletes the table and all of its rows.' },
  deleteTableRow: { confirm: 'This deletes the row.' },
  deleteTableColumn: {
    confirm: 'This deletes the column and its values in every row.',
    fields: [{ header: 'remaining columns', path: 'columns', format: 'count' }],
  },
  deleteKnowledgeBase: { confirm: 'This deletes the knowledge base and every document in it.' },
  deleteKnowledgeDocument: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    confirm: 'This deletes the document and its embeddings.',
  },
  deleteKnowledgeConnector: {
    confirm:
      'This deletes the connector; --delete-documents also deletes its synchronized documents.',
  },
  deleteFile: { confirm: 'This archives the file.' },
  deleteCredential: {
    confirm: 'This disconnects the credential and removes its stored authentication.',
  },
  deleteSkill: { confirm: 'This deletes the skill.' },
  revokeSkillEditor: {
    confirm: 'This revokes the explicit skill editor grant for the selected email.',
  },
  deleteCustomTool: { confirm: 'This deletes the custom tool.' },
  deleteMcpServer: {
    confirm: 'This removes the MCP server and the tools it provides.',
  },
  deleteSecret: {
    confirm: 'This deletes the secret; anything using it may stop working.',
  },
  deleteWorkflow: { confirm: 'This deletes the workflow and its run history.' },
  deleteTableView: { confirm: 'This deletes the saved view and its filters.' },
  deleteWorkflowGroup: {
    // Not just the grouping: the documented behaviour is that every column the
    // group fed goes with it, values included.
    confirm: 'This deletes the group, every column it fed, and the values in them.',
    fields: [
      { header: 'id' },
      { header: 'deleted', format: 'bool' },
      { header: 'remaining columns', path: 'columns', format: 'count' },
    ],
  },
  // ─── Fields whose type misdescribes their meaning ─────────────────────────
  // `z.string()` that the route splits on commas. No generator can infer this.
  listLogs: {
    flags: {
      workflowIds: { name: 'workflow', list: true },
      folderPaths: { ...FOLDER_PATH_FLAG, list: true },
      triggers: { name: 'trigger', list: true },
      // The `workflow` column below reads `workflow.name`, which the API only
      // sends at `full` — at its own `basic` default every row's workflow was an
      // em-dash and a run had nothing naming what ran. Asked for by default so
      // the declared columns can be filled; an explicit `--details basic` wins.
      details: {
        requestDefault: 'full',
        describe: 'Response detail level; full is requested by default to name each run’s workflow',
      },
      includeTraceSpans: {
        boolean: true,
        describe: 'Include trace spans in JSON or YAML output (implies full detail)',
      },
      includeFinalOutput: {
        boolean: true,
        describe: 'Include final output in JSON or YAML output (implies full detail)',
      },
    },
    columns: [
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'status' },
      { header: 'level' },
      { header: 'trigger' },
      { header: 'workflow', path: 'workflow.name' },
      { header: 'duration', path: 'totalDurationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost' },
      { header: 'run', path: 'runId' },
    ],
  },
  getLog: {
    describe: 'Show run diagnostics',
    expandedTrace: true,
    fields: [
      { header: 'run', path: 'runId' },
      { header: 'workflow', path: 'workflow.name' },
      { header: 'status' },
      { header: 'level' },
      { header: 'trigger' },
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'ended', path: 'endedAt', format: 'timestamp' },
      { header: 'duration', path: 'totalDurationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost' },
      { header: 'files', format: 'count' },
      { header: 'trace', path: 'traceSpans', format: 'trace-count' },
    ],
  },
  searchKnowledge: {
    // Accepts a string or an array on the wire; the CLI always sends the array.
    flags: {
      knowledgeBaseIds: { name: 'kb', list: true, describe: 'Knowledge base ID (repeatable)' },
      query: { describe: 'Text to search for' },
      tagFilters: {
        json: true,
        describe: 'Tag filters as [{"tagName":"...","operator":"...","value":"..."}]',
      },
      searchMode: {
        choices: ['vector', 'hybrid'],
        describe: 'Search algorithm',
      },
    },
    itemsPath: 'results',
    columns: [
      { header: 'score', path: 'similarity', format: 'score' },
      { header: 'document', path: 'documentName' },
      { header: 'chunk', path: 'chunkIndex' },
      { header: 'content' },
    ],
  },

  // ─── Friendlier flag names ────────────────────────────────────────────────
  upsertTableRow: {
    describe: 'Insert a row, or update the one that conflicts on a unique column',
    flags: {
      data: { json: true },
      conflictTarget: { name: 'on', describe: 'Unique column to resolve the conflict against' },
    },
    columns: [{ header: 'id' }, { header: 'operation' }],
  },
  queryRows: {
    command: 'tables rows query',
    flags: {
      predicate: { name: 'filter', json: true, describe: TABLE_READ_FILTER_HELP },
      sort: { json: true, describe: TABLE_SORT_HELP },
    },
    // A row's cells live under `data`; without this the table showed an id and
    // two timestamps per row and none of the content anyone ran the query for.
    expand: 'data',
  },
  createTableRows: {
    bodyVariants: [
      {
        name: 'data',
        property: 'data',
        kind: 'object',
        describe: 'One row keyed by column name',
      },
      {
        name: 'rows',
        property: 'rows',
        kind: 'array',
        describe: 'Several rows keyed by column name',
      },
    ],
  },
  createTable: {
    flags: {
      name: { describe: TABLE_NAME_HELP },
      folderPath: FOLDER_PATH_FLAG,
      schema: {
        json: true,
        describe: 'Table schema: {"columns":[{"name":"email","type":"string"}]}',
      },
    },
  },
  updateTable: {
    variants: [moveResource('tables mv', 'table')],
    flags: {
      name: { describe: TABLE_NAME_HELP },
      folderPath: FOLDER_PATH_FLAG,
    },
  },
  createFile: { flags: { folderPath: FOLDER_PATH_FLAG } },
  createKnowledgeBase: { flags: { folderPath: FOLDER_PATH_FLAG } },
  updateKnowledgeBase: {
    variants: [moveResource('knowledge mv', 'knowledge base')],
    flags: { folderPath: FOLDER_PATH_FLAG },
  },
  createWorkflow: { flags: { folderPath: FOLDER_PATH_FLAG } },
  updateWorkflow: {
    variants: [moveResource('workflows mv', 'workflow')],
    flags: { folderPath: FOLDER_PATH_FLAG },
  },
  importWorkflow: { flags: { folderPath: FOLDER_PATH_FLAG } },
  createCustomTool: { flags: { schema: { json: true, describe: CUSTOM_TOOL_SCHEMA_HELP } } },
  updateCustomTool: { flags: { schema: { json: true, describe: CUSTOM_TOOL_SCHEMA_HELP } } },

  // ─── Output columns for list commands ─────────────────────────────────────
  listTables: {
    flags: { folderPath: FOLDER_PATH_FLAG },
    columns: [
      { header: 'id' },
      { header: 'name' },
      FOLDER_COLUMN,
      { header: 'rows', path: 'rowCount' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  listWorkflows: {
    flags: { folderPath: FOLDER_PATH_FLAG },
    columns: [
      { header: 'id' },
      { header: 'name' },
      FOLDER_COLUMN,
      { header: 'deployed', path: 'isDeployed', format: 'bool' },
      { header: 'runs', path: 'runCount' },
      { header: 'last run', path: 'lastRunAt', format: 'timestamp' },
    ],
  },
  listFiles: {
    flags: { folderPath: FOLDER_PATH_FLAG },
    columns: [
      { header: 'id' },
      { header: 'name' },
      // Now that files live in folders, which one is the difference between two
      // identically-named rows.
      FOLDER_COLUMN,
      { header: 'size', format: 'bytes' },
      { header: 'type' },
      { header: 'uploaded by', path: 'uploadedByEmail' },
      { header: 'uploaded', path: 'uploadedAt', format: 'timestamp' },
    ],
  },
  listTableRows: { expand: 'data' },
  listKnowledgeBases: {
    flags: { folderPath: FOLDER_PATH_FLAG },
    columns: [
      { header: 'id' },
      { header: 'name' },
      FOLDER_COLUMN,
      { header: 'docs', path: 'docCount' },
      { header: 'tokens', path: 'tokenCount' },
      { header: 'model', path: 'embeddingModel' },
    ],
  },
  // Every command whose `[id]` is the parent knowledge base rather than the
  // thing being acted on names it in its own help and error messages. `update`
  // and `tags list` were left out, so the same value was `<id>` on one command
  // and `<knowledgeBaseId>` on its neighbours.
  getKnowledgeDocument: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  updateKnowledgeDocument: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  listKnowledgeTags: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  listKnowledgeDocuments: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    columns: [
      { header: 'id' },
      { header: 'filename' },
      { header: 'size', path: 'fileSize', format: 'bytes' },
      { header: 'status', path: 'processingStatus' },
      { header: 'chunks', path: 'chunkCount' },
    ],
  },
  // Without these the inferred fallback dumps every scalar field — 20 columns
  // for an MCP server, including `hasOauthClientSecret`.
  listMcpServers: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'transport' },
      { header: 'url' },
      { header: 'status', path: 'connectionStatus' },
      { header: 'tools', path: 'toolCount' },
      { header: 'enabled', format: 'bool' },
    ],
  },
  listSkills: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'description' },
      { header: 'built-in', path: 'readOnly', format: 'bool' },
    ],
  },
  listCustomTools: {
    columns: [
      { header: 'id' },
      { header: 'name', path: 'title' },
      { header: 'description', path: 'schema.function.description' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  listCredentials: {
    columns: [
      { header: 'id' },
      { header: 'name', path: 'displayName' },
      { header: 'provider', path: 'providerId' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  // Inferred, this was eleven columns wide, four of them belonging to a detail
  // view rather than a catalogue: `docsUrl`, `helpText`,
  // `requiresClientGeneratedCredentialId` and the nested `fields` are what you
  // read once you have chosen a provider, not what you scan to choose one.
  //
  // Both ids stay, because the next command takes one or the other and which
  // depends on the row: `credentials connect` names an OAuth provider by
  // `serviceId`, while `credentials create` matches a service-account provider
  // on `providerId`. Each is empty on the kind of row that does not use it.
  listCredentialProviders: {
    columns: [
      { header: 'type' },
      { header: 'service', path: 'serviceId' },
      { header: 'provider', path: 'providerId' },
      { header: 'name' },
      { header: 'family', path: 'providerFamily' },
      { header: 'available', format: 'bool' },
      { header: 'description' },
    ],
  },
  listSecrets: {
    // `description` trails the existing columns: `--output text` is positional,
    // so inserting ahead of `updated` would shift every field a script already cuts.
    columns: [
      { header: 'name' },
      { header: 'scope' },
      { header: 'role' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
      { header: 'description' },
    ],
  },
  getWorkspace: {
    profileWorkspacePath: true,
    fields: [
      { header: 'id' },
      { header: 'name' },
      { header: 'mode' },
      { header: 'members', path: 'memberCount' },
      { header: 'created', path: 'createdAt', format: 'timestamp' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  listWorkspaceMembers: {
    command: 'workspaces members',
    describe: 'List workspace members',
    profileWorkspacePath: true,
    columns: [
      { header: 'email' },
      { header: 'name' },
      { header: 'role' },
      { header: 'external', path: 'isExternal', format: 'bool' },
      { header: 'joined', path: 'joinedAt', format: 'timestamp' },
    ],
  },

  listAuditLogs: {
    allWorkspaces: true,
    flags: {
      organizationId: {
        name: 'organization',
        describe: 'Organization ID (personal API key required)',
      },
    },
    columns: [
      { header: 'at', path: 'createdAt', format: 'timestamp' },
      { header: 'workspace', path: 'workspaceId' },
      { header: 'actor', path: 'actorEmail' },
      { header: 'action' },
      { header: 'resource', path: 'resourceName' },
    ],
  },
  getAuditLog: {
    flags: {
      organizationId: {
        name: 'organization',
        describe: 'Organization ID (personal API key required)',
      },
    },
  },

  // ─── The expanded files surface ───────────────────────────────────────────
  // Every one of these derives badly. `/files/move`, `/files/bulk-delete` and
  // `/files/[fileId]/restore` are verbs sitting where the deriver expects a
  // sub-resource, so it made them groups holding a lone `create`.
  bulkDeleteFiles: {
    // `batch-` for the bulk form, matching `tables rows batch-delete`.
    command: 'files batch-delete',
    describe: 'Delete several files at once',
    flags: {
      fileIds: { list: true },
    },
    confirm: 'This deletes every listed file.',
  },
  getFile: {
    command: 'files describe',
    describe: 'Show file metadata and sharing status',
    fields: [
      { header: 'id' },
      { header: 'name' },
      { header: 'size', format: 'bytes' },
      { header: 'type' },
      FOLDER_COLUMN,
      { header: 'uploaded by', path: 'uploadedByEmail' },
      { header: 'uploaded', path: 'uploadedAt', format: 'timestamp' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
      // v2 returns the share under `share` (null when unshared), and its flag
      // is `isActive`.
      { header: 'shared', path: 'share.isActive', format: 'bool' },
      { header: 'share URL', path: 'share.url' },
      { header: 'share auth', path: 'share.authType' },
      { header: 'allowed emails', path: 'share.allowedEmails', format: 'count' },
    ],
  },
  moveFileItems: {
    command: 'files move',
    aliases: ['mv'],
    describe: 'Move files into another folder',
    flags: {
      fileIds: { list: true },
      targetFolderPath: {
        ...FOLDER_PATH_INPUT,
        name: 'to',
        describe: 'Destination folder path; omit for root',
      },
    },
  },
  renameFile: {
    // Derived to `files update`, which contradicted its own summary.
    command: 'files rename',
    describe: 'Rename a file',
  },
  restoreFile: {
    // `files restore create` created nothing; it is the inverse of the delete
    // that archived the file.
    command: 'files restore',
    renamedFrom: ['files restore create'],
    describe: 'Restore an archived file',
  },
  updateFileContent: {
    command: 'files set-content',
    describe: 'Replace a file’s contents',
    flags: {
      encoding: { choices: ['utf-8', 'base64'], describe: 'Content encoding' },
    },
  },
  // Both share commands return the share itself as `data`, which the runtime
  // unwraps, so these fields sit at the top level rather than under a wrapper.
  getFileShare: {
    command: 'files share get',
    describe: 'Show a file’s share settings',
    fields: [
      { header: 'shared', path: 'isActive', format: 'bool' },
      { header: 'URL', path: 'url' },
      { header: 'auth', path: 'authType' },
      { header: 'password set', path: 'hasPassword', format: 'bool' },
      { header: 'allowed emails', path: 'allowedEmails', format: 'count' },
    ],
  },
  // v2 folds share and unshare into one PATCH; `--is-active false` disables it,
  // so there is no separate unshare operation to expose.
  upsertFileShare: {
    command: 'files share set',
    describe: 'Enable or disable sharing for a file',
    flags: {
      allowedEmails: { list: true },
    },
    fields: [
      { header: 'shared', path: 'isActive', format: 'bool' },
      { header: 'URL', path: 'url' },
      { header: 'auth', path: 'authType' },
      { header: 'password set', path: 'hasPassword', format: 'bool' },
      { header: 'allowed emails', path: 'allowedEmails', format: 'count' },
    ],
  },

  // ─── Resource-scoped, path-addressed folders ──────────────────────────────
  listFileFolders: {
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  listKnowledgeFolders: {
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  listTableFolders: {
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  listWorkflowFolders: {
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  createFileFolder: {
    positionals: ['path'],
    flags: { path: FOLDER_PATH_INPUT },
    describe: 'Create a file folder at a path',
  },
  createKnowledgeFolder: {
    positionals: ['path'],
    flags: { path: FOLDER_PATH_INPUT },
    describe: 'Create a knowledge folder at a path',
  },
  createTableFolder: {
    positionals: ['path'],
    flags: { path: FOLDER_PATH_INPUT },
    describe: 'Create a table folder at a path',
  },
  createWorkflowFolder: {
    positionals: ['path'],
    flags: { path: FOLDER_PATH_INPUT },
    describe: 'Create a workflow folder at a path',
  },
  relocateFileFolder: {
    command: 'files folders move',
    aliases: ['mv'],
    positionals: ['path', 'destinationPath'],
    flags: {
      path: FOLDER_PATH_INPUT,
      destinationPath: { ...FOLDER_PATH_INPUT, name: 'destination' },
    },
    describe: 'Rename or move a file folder',
  },
  relocateKnowledgeFolder: {
    command: 'knowledge folders move',
    aliases: ['mv'],
    positionals: ['path', 'destinationPath'],
    flags: {
      path: FOLDER_PATH_INPUT,
      destinationPath: { ...FOLDER_PATH_INPUT, name: 'destination' },
    },
    describe: 'Rename or move a knowledge folder',
  },
  relocateTableFolder: {
    command: 'tables folders move',
    aliases: ['mv'],
    positionals: ['path', 'destinationPath'],
    flags: {
      path: FOLDER_PATH_INPUT,
      destinationPath: { ...FOLDER_PATH_INPUT, name: 'destination' },
    },
    describe: 'Rename or move a table folder',
  },
  relocateWorkflowFolder: {
    command: 'workflows folders move',
    aliases: ['mv'],
    positionals: ['path', 'destinationPath'],
    flags: {
      path: FOLDER_PATH_INPUT,
      destinationPath: { ...FOLDER_PATH_INPUT, name: 'destination' },
    },
    describe: 'Rename or move a workflow folder',
  },
  deleteFileFolder: {
    positionals: ['path'],
    flags: FOLDER_DELETE_FLAGS,
    confirm: 'This archives the file folder and, when recursive, everything inside it.',
  },
  deleteKnowledgeFolder: {
    positionals: ['path'],
    flags: FOLDER_DELETE_FLAGS,
    confirm: 'This archives the knowledge folder and, when recursive, everything inside it.',
  },
  deleteTableFolder: {
    positionals: ['path'],
    flags: FOLDER_DELETE_FLAGS,
    confirm: 'This archives the table folder and, when recursive, everything inside it.',
  },
  deleteWorkflowFolder: {
    positionals: ['path'],
    flags: FOLDER_DELETE_FLAGS,
    confirm: 'This archives the workflow folder and, when recursive, everything inside it.',
  },

  // ─── The expanded tables surface ──────────────────────────────────────────
  // `/cancel-runs`, `/rows/find`, `/query/count`, `/columns/run` and the
  // enrichment path all put a verb where the deriver expects a sub-resource, so
  // each became a group holding a lone `create`.
  cancelTableRuns: {
    command: 'tables cancel-runs',
    describe: 'Stop every running column job',
    flags: {
      excludeRowIds: { list: true },
      filter: { json: true, describe: TABLE_FILTER_HELP },
    },
  },
  findTableRows: {
    command: 'tables rows find',
    describe: 'Find rows matching a predicate',
    flags: {
      // `--q` was the wire field spelled out; the same idea is `--query` on
      // `knowledge search`, and one concept should not have two flag names.
      q: { name: 'query', renamedFrom: ['q'], describe: 'Value to find' },
      predicate: { name: 'filter', json: true, describe: TABLE_FILTER_HELP },
      sort: { json: true, describe: TABLE_SORT_HELP },
    },
    itemsPath: 'matches',
    columns: [{ header: 'ordinal' }, { header: 'row', path: 'rowId' }, { header: 'column' }],
  },
  queryRowsCount: {
    // `tables count create` counted rows and created nothing. The count is a
    // question about rows, so it belongs beside the other row commands.
    command: 'tables rows count',
    renamedFrom: ['tables count create'],
    describe: 'Count rows matching a filter',
    flags: {
      predicate: {
        name: 'filter',
        renamedFrom: ['predicate'],
        json: true,
        describe: TABLE_READ_FILTER_HELP,
      },
    },
  },
  runTableColumn: {
    command: 'tables columns run',
    describe: 'Run a column’s workflow',
    flags: {
      groupIds: { list: true },
      rowIds: { list: true },
      excludeRowIds: { list: true },
      filter: { json: true, describe: TABLE_FILTER_HELP },
    },
  },
  runRowEnrichment: {
    command: 'tables rows enrich',
    describe: 'Run one row’s enrichment group',
  },

  // The handshake behind `sim tables import`. Its halfway states hold storage
  // and a half-sent import is not something to leave reachable, so the steps
  // stay hidden — unlike `get` and `cancel`, which are useful on their own for
  // an import already running.
  createTableImport: { hidden: true },
  createTableImportPartUrls: { hidden: true },
  completeTableImport: { hidden: true },
  cancelTableImport: { command: 'tables imports cancel' },
  cancelTableExport: { command: 'tables exports cancel' },
  tableExportDownload: {
    // GET, but it returns a signed URL rather than a listing.
    command: 'tables exports download',
    describe: 'Get the download URL for a finished export',
  },

  // ─── Documents, not records ───────────────────────────────────────────────
  // The payload is the artifact: `sim workflows export <id> > wf.json` has to
  // produce something `sim workflows import` accepts back.
  exportWorkflow: {
    describe: 'Print a workflow as a portable JSON document',
    document: true,
  },

  // ─── Runs ─────────────────────────────────────────────────────────────────
  // The derived names land badly here: `/execute` and `/cancel` are verbs in
  // the path, but neither is in the action list, so POST would derive
  // `workflows execute create` and `workflows cancel create`.
  executeWorkflow: {
    command: 'workflows run',
    describe: 'Run a deployed workflow',
    flags: {
      async: { boolean: true, describe: 'Queue the run and return immediately' },
      input: { json: true, describe: 'Trigger input as JSON' },
      selectedOutputs: {
        name: 'select-output',
        list: true,
        describe:
          'Return blockName.field values (e.g. agent_1.content); missing fields are omitted',
      },
      // SSE, not JSON — the generic client cannot consume it, so the response
      // encoding is chosen by `--follow`, which `workflow-run-follow.ts` adds to
      // this same leaf and renders by hand. These stay omitted because sending
      // them down the generated path would still break it.
      stream: { omit: true },
      includeThinking: { omit: true },
      includeToolCalls: { omit: true },
    },
  },
  getWorkflowRun: {
    command: 'workflows runs get',
    pathFlags: WORKFLOW_RUN_SCOPE,
    describe: 'Show run status (requested outputs are included in JSON or YAML output)',
    flags: {
      includeOutput: {
        boolean: true,
        describe: 'Include the final output in JSON or YAML output',
      },
      selectedOutputs: {
        name: 'select-output',
        list: true,
        describe: 'Include blockName.field values in JSON or YAML output (e.g. agent_1.content)',
      },
    },
    fields: [
      { header: 'run', path: 'runId' },
      { header: 'workflow', path: 'workflowId' },
      { header: 'status' },
      { header: 'trigger' },
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'ended', path: 'endedAt', format: 'timestamp' },
      { header: 'duration', path: 'durationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost' },
      { header: 'context', path: 'paused.contextId' },
      { header: 'pause kind', path: 'paused.pauseKind' },
      { header: 'paused at', path: 'paused.pausedAt', format: 'timestamp' },
      { header: 'resume at', path: 'paused.resumeAt', format: 'timestamp' },
      { header: 'blocked on', path: 'paused.blockedOnBlockId' },
      { header: 'pause points', path: 'paused.pausePointCount' },
      { header: 'error', path: 'error.message' },
    ],
  },
  listWorkflowRuns: {
    command: 'workflows runs list',
    pathFlags: WORKFLOW_RUN_SCOPE,
    describe: 'List runs for a workflow',
    columns: [
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'status' },
      { header: 'trigger' },
      { header: 'duration', path: 'durationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost' },
      { header: 'run', path: 'runId' },
    ],
  },
  cancelWorkflowRun: {
    command: 'workflows runs cancel',
    pathFlags: WORKFLOW_RUN_SCOPE,
    describe: 'Cancel a running workflow run',
    // Not `confirm`-gated: cancelling is recoverable (re-run it), and the
    // whole point is to stop something that is already going wrong.
  },
  resumeWorkflow: {
    command: 'workflows runs resume',
    pathFlags: WORKFLOW_RUN_SCOPE,
    describe: 'Resume a paused run (output is included in JSON or YAML output)',
    flags: {
      contextId: {
        name: 'context',
        describe: 'Pause context ID returned by run status',
      },
      input: {
        json: true,
        describe: 'Resume input as JSON',
      },
    },
    fields: [
      { header: 'run', path: 'runId' },
      { header: 'workflow', path: 'workflowId' },
      { header: 'status' },
      { header: 'status URL', path: 'statusUrl' },
      { header: 'queue position', path: 'queuePosition' },
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'ended', path: 'endedAt', format: 'timestamp' },
      { header: 'duration', path: 'durationMs', format: 'duration' },
      { header: 'error', path: 'error.message' },
    ],
  },

  // ─── Not a terminal-shaped operation ──────────────────────────────────────
  // Multipart upload; `sim knowledge documents upload <id> <path>` needs its
  // own file-reading command rather than a generated flag surface.
  uploadKnowledgeDocument: { hidden: true },
  createKnowledgeDocumentUpload: { hidden: true },
  createKnowledgeDocumentUploadPartUrls: { hidden: true },
  completeKnowledgeDocumentUpload: { hidden: true },
  abortKnowledgeDocumentUpload: { hidden: true },

  // ─── Steps of a transfer, not commands ────────────────────────────────────
  // Uploading is now a presigned multipart handshake: create the upload, ask for
  // part URLs in batches, PUT each part to storage, then complete with the
  // ETags — and abort if any of it fails. Exposing the steps individually would
  // advertise a protocol whose halfway states leak storage, so `sim files
  // upload` drives the whole sequence and these stay out of the surface.
  createFileUpload: { hidden: true },
  createFileUploadPartUrls: { hidden: true },
  completeFileUpload: { hidden: true },
  abortFileUpload: { hidden: true },
}
