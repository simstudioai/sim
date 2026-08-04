import type { CliContract } from './types.js'

const TABLE_NAME_HELP = 'Identifier: letters, numbers, and underscores; cannot start with a number'
const TABLE_FILTER_HELP =
  'Predicate tree using all/any and operators eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, like, ilike, nlike, nilike, isEmpty, isNotEmpty, isNull, or isNotNull'
const CUSTOM_TOOL_SCHEMA_HELP =
  'OpenAI function schema: {"type":"function","function":{"name":"...","parameters":{"type":"object","properties":{}}}}'

/**
 * The CLI contract for the v2 surface.
 *
 * Read this as a diff against what is already derivable — an operation absent
 * from this table still gets a command, built entirely from the generated
 * operation table. Only the entries below needed a human.
 *
 * Derived by default:
 *   listTables            → sim tables list
 *   getKnowledgeDocument  → sim knowledge documents get <id> <documentId>
 *   upsertTableRow        → sim tables upsert <tableId>
 */
export const CLI_CONTRACT: CliContract = {
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
  // `DELETE /workflows/[id]/deploy` is an undeploy, not a delete.
  undeployWorkflow: {
    command: 'workflows undeploy',
    describe: 'Take a workflow out of deployment',
  },

  // ─── Destructive single-resource operations ───────────────────────────────
  deleteTable: { confirm: 'This deletes the table and all of its rows.' },
  deleteTableRow: { confirm: 'This deletes the row.' },
  deleteTableColumn: {
    confirm: 'This deletes the column and its values in every row.',
    fields: [{ header: 'remaining columns', path: 'columns', format: 'count' }],
  },
  deleteKnowledgeBase: { confirm: 'This deletes the knowledge base and every document in it.' },
  deleteKnowledgeDocument: { confirm: 'This deletes the document and its embeddings.' },
  deleteFile: { confirm: 'This archives the file.' },
  deleteSkill: { confirm: 'This deletes the skill.' },
  deleteCustomTool: { confirm: 'This deletes the custom tool.' },
  deleteMcpServer: {
    confirm: 'This removes the MCP server and the tools it provides.',
  },
  deleteCredential: {
    confirm: 'This deletes the credential; anything authenticating with it stops working.',
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
  deleteFolder: {
    // The route archives the folder *and cascades to its contents*, so this is
    // the broadest delete on the surface — the message says so rather than
    // reading like a single-item removal.
    confirm: 'This archives the folder and everything inside it.',
  },

  // ─── Fields whose type misdescribes their meaning ─────────────────────────
  // `z.string()` that the route splits on commas. No generator can infer this.
  listLogs: {
    flags: {
      workflowIds: { name: 'workflow', list: true },
      folderIds: { name: 'folder', list: true },
      triggers: { name: 'trigger', list: true },
    },
    columns: [
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'level' },
      { header: 'trigger' },
      { header: 'workflow', path: 'workflow.name' },
      { header: 'duration', path: 'totalDurationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost' },
      { header: 'execution', path: 'executionId' },
    ],
  },
  getLog: {
    describe: 'Show a log summary (execution data is available in JSON or YAML output)',
    fields: [
      { header: 'id' },
      { header: 'execution', path: 'executionId' },
      { header: 'workflow', path: 'workflow.name' },
      { header: 'level' },
      { header: 'trigger' },
      { header: 'started', path: 'startedAt', format: 'timestamp' },
      { header: 'ended', path: 'endedAt', format: 'timestamp' },
      { header: 'duration', path: 'totalDurationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost' },
      { header: 'files', format: 'count' },
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
      { header: 'score', path: 'similarity' },
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
      predicate: { name: 'filter', json: true, describe: TABLE_FILTER_HELP },
      sort: { json: true },
    },
    // A row's cells live under `data`; without this the table showed an id and
    // two timestamps per row and none of the content anyone ran the query for.
    expand: 'data',
  },
  createTable: {
    flags: {
      name: { describe: TABLE_NAME_HELP },
      schema: {
        json: true,
        describe: 'Table schema: {"columns":[{"name":"email","type":"string"}]}',
      },
    },
  },
  updateTable: { flags: { name: { describe: TABLE_NAME_HELP } } },
  createCustomTool: { flags: { schema: { json: true, describe: CUSTOM_TOOL_SCHEMA_HELP } } },
  updateCustomTool: { flags: { schema: { json: true, describe: CUSTOM_TOOL_SCHEMA_HELP } } },

  // ─── Output columns for list commands ─────────────────────────────────────
  listTables: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'rows', path: 'rowCount' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  listWorkflows: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'deployed', path: 'isDeployed', format: 'bool' },
      { header: 'runs', path: 'runCount' },
      { header: 'last run', path: 'lastRunAt', format: 'timestamp' },
    ],
  },
  listFiles: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      // Now that files live in folders, which one is the difference between two
      // identically-named rows.
      { header: 'folder', path: 'folderPath' },
      { header: 'size', format: 'bytes' },
      { header: 'type' },
      { header: 'uploaded', path: 'uploadedAt', format: 'timestamp' },
    ],
  },
  listTableRows: { expand: 'data' },
  listKnowledgeBases: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'docs', path: 'docCount' },
      { header: 'tokens', path: 'tokenCount' },
      { header: 'model', path: 'embeddingModel' },
    ],
  },
  listKnowledgeDocuments: {
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
  listFolders: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'parent', path: 'parentId' },
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

  listAuditLogs: {
    columns: [
      { header: 'at', path: 'createdAt', format: 'timestamp' },
      { header: 'actor', path: 'actorEmail' },
      { header: 'action' },
      { header: 'resource', path: 'resourceName' },
    ],
  },

  // ─── The expanded files surface ───────────────────────────────────────────
  // Every one of these derives badly. `/files/move` and `/files/bulk-archive`
  // are verbs sitting where the deriver expects a sub-resource, so it made them
  // groups holding a lone `create`; and `GET /files/[id]/share` fetches one
  // share, which the deriver read as a collection and named `list`.
  bulkArchiveFileItems: {
    // `batch-` for the bulk form, matching `tables rows batch-delete`.
    command: 'files batch-archive',
    describe: 'Archive several files and folders at once',
    confirm: 'This archives every listed file and folder, and everything inside those folders.',
  },
  moveFileItems: {
    command: 'files move',
    describe: 'Move files and folders into another folder',
  },
  renameFile: {
    // Derived to `files update`, which contradicted its own summary.
    command: 'files rename',
    describe: 'Rename a file',
  },
  restoreFile: {
    command: 'files restore',
    describe: 'Restore an archived file',
  },
  updateFileContent: {
    command: 'files set-content',
    describe: 'Replace a file’s contents',
    flags: {
      encoding: { choices: ['utf-8', 'base64'], describe: 'Content encoding' },
    },
  },
  getFileShare: {
    command: 'files share get',
    describe: 'Show a file’s share settings',
  },
  upsertFileShare: {
    command: 'files share set',
    describe: 'Enable or disable sharing for a file',
  },

  // ─── The expanded tables surface ──────────────────────────────────────────
  // `/cancel-runs`, `/rows/find`, `/restore`, `/columns/run` and the enrichment
  // path all put a verb where the deriver expects a sub-resource, so each became
  // a group holding a lone `create`.
  cancelTableRuns: { command: 'tables cancel-runs', describe: 'Stop every running column job' },
  findTableRows: {
    command: 'tables rows find',
    describe: 'Find rows matching a predicate',
    flags: {
      q: { describe: 'Value to find' },
      predicate: { name: 'filter', json: true, describe: TABLE_FILTER_HELP },
      sort: { json: true },
    },
    itemsPath: 'matches',
    columns: [{ header: 'ordinal' }, { header: 'row', path: 'rowId' }, { header: 'column' }],
  },
  restoreTable: { command: 'tables restore', describe: 'Restore a deleted table' },
  runTableColumn: {
    command: 'tables columns run',
    describe: 'Run a column’s workflow',
    flags: { filter: { json: true, describe: TABLE_FILTER_HELP } },
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

  // ─── Execution ────────────────────────────────────────────────────────────
  // The derived names land badly here: `/execute` and `/cancel` are verbs in
  // the path, but neither is in the action list, so POST would derive
  // `workflows execute create` and `workflows cancel create`.
  executeWorkflow: {
    command: 'workflows run',
    describe: 'Run a deployed workflow and wait for the result',
    flags: {
      input: { json: true, describe: 'Trigger input as JSON' },
      selectedOutputs: { name: 'output', list: true },
      // SSE, not JSON — the generic client cannot consume it. A `sim workflows
      // run --follow` that renders the stream is a separate, hand-written
      // command; advertising a flag that breaks the response is worse than
      // not offering it yet.
      stream: { omit: true },
    },
  },
  getWorkflowExecution: {
    command: 'workflows executions get',
    describe: 'Show the status of one execution',
  },
  cancelWorkflowExecution: {
    command: 'workflows executions cancel',
    describe: 'Cancel a running execution',
    // Not `confirm`-gated: cancelling is recoverable (re-run it), and the
    // whole point is to stop something that is already going wrong.
  },

  // ─── Not a terminal-shaped operation ──────────────────────────────────────
  // Multipart upload; `sim knowledge documents upload <path>` would need its own
  // file-reading command rather than a generated flag surface.
  uploadKnowledgeDocument: { hidden: true },

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
