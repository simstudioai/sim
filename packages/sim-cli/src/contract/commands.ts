import type { CliContract, ColumnSpec, CommandVariantSpec } from './types'

const TABLE_NAME_HELP = 'Identifier: letters, numbers, and underscores; cannot start with a number'
const TABLE_FILTER_HELP =
  'Predicate: {"all":[{"field":"status","op":"eq","value":"active"}]}; groups use all/any. Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, like, ilike, nlike, nilike, isEmpty, isNotEmpty, isNull, isNotNull'
const TABLE_READ_FILTER_HELP =
  'Condition: {"field":"status","op":"eq","value":"active"}. Groups: {"all":[{"field":"status","op":"eq","value":"active"}]} or {"any":[{"field":"status","op":"eq","value":"active"}]}; group entries may also be nested groups. Operators: eq, ne, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith, endsWith, like, ilike, nlike, nilike, isEmpty, isNotEmpty, isNull, isNotNull'
const TABLE_SORT_HELP =
  'Ordered sort keys: [{"field":"createdAt","direction":"desc"}] (direction: asc or desc)'
const KNOWLEDGE_TAG_DEFINITIONS_HELP =
  'Tag definitions: [{"tagSlot":"tag1","displayName":"category","fieldType":"text"}]'
const CUSTOM_TOOL_SCHEMA_HELP =
  'OpenAI function schema: {"type":"function","function":{"name":"...","parameters":{"type":"object","properties":{}}}}'
const DISPATCH_ROW_LIMIT_HELP =
  'Stop after this many eligible rows have run (1-1,000,000). Omit for an unbounded run'
const FILE_EDIT_HELP =
  'One edit object: {"mode":"search_replace","search":"old","content":"new","replaceAll":false}, {"mode":"replace_between","beforeAnchor":"start line","afterAnchor":"end line","content":"new"}, {"mode":"insert_after","anchor":"line","content":"new"}, or {"mode":"delete_between","startAnchor":"first line deleted","endAnchor":"ending line kept"}. Anchored modes also accept occurrence starting at 1'
/**
 * The shapes behind the graph-write batches.
 *
 * Both fields are `z.array(z.unknown())` on the wire, so the generated help
 * said only `<json|@file>` and the discriminant that decides what an entry even
 * means appeared nowhere in the terminal. One example per arm is what makes the
 * shape guessable, the same way `TABLE_FILTER_HELP` does for the predicate.
 */
const WORKFLOW_OPERATIONS_HELP =
  'Edits to apply, in a single batch, keyed by operation_type: [{"operation_type":"add","block_id":"my-fn","params":{"type":"function","name":"My Fn","inputs":{"code":"return {ok:true}"}}},{"operation_type":"edit","block_id":"<uuid>","params":{"name":"Renamed","connections":{"success":"my-fn"}}},{"operation_type":"delete","block_id":"<uuid>"}]. Also extract_from_subflow, whose params carry {"subflowId":"<loop-id>"}, and insert_into_subflow, which creates a block and so takes an add’s params plus that subflowId'
const WORKFLOW_SET_BLOCK_ENABLED_HELP =
  'Blocks to enable or disable, applied after --operations: [{"block_id":"<uuid>","enabled":false}]. Disabling a loop or parallel cascades to its unlocked descendants; enabling a block whose container is disabled is declined'
const WORKFLOW_VARIABLE_OPERATIONS_HELP =
  'Variable changes to apply in order, keyed by operation: [{"operation":"add","name":"my_var","type":"string","value":"hello"},{"operation":"edit","name":"my_var","value":"updated"},{"operation":"delete","name":"my_var"}]'
const MCP_PARAMETER_DESCRIPTIONS_HELP =
  'Per-field description overrides applied to the schema generated from the deployed workflow inputs, as [{"name":"email","description":"Customer email address"}]. A name matching no input field is ignored'
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
const KNOWLEDGE_BASE_PATH_ARGUMENT = { knowledgeBaseId: 'knowledgeBaseId' } as const
/**
 * The signed control token a transfer route accepts, kept off the terminal.
 *
 * It is minted inside a handshake the CLI drives end to end and is never
 * printed, so there is no supported way for a caller to be holding one — a flag
 * for it can only fail, and where it is required the command it gates is
 * unreachable by construction. The token path exists for a raw-API caller
 * mid-upload; the CLI reaches the same resources through the API key and
 * workspace it already sends.
 */
const TRANSFER_TOKEN_OMITTED = { 'upload-token': { omit: true } } as const
const WORKFLOW_RUN_SCOPE = {
  workflowId: {
    name: 'workflow',
    placeholder: 'workflowId',
    describe: 'Workflow ID',
  },
} as const
const FOLDER_PATHS_FLAG = { ...FOLDER_PATH_FLAG, list: true } as const
const TARGET_FOLDER_PATH_FLAG = {
  ...FOLDER_PATH_INPUT,
  name: 'to',
  describe: 'Destination folder path; omit for root',
} as const
/**
 * The comma-split list filters every log read shares.
 *
 * `listLogs`, `getLogStats` and `queryLogs` accept the same `z.string()` fields
 * that the route splits on commas. They live on one constant because a flag
 * that means `--workflow` on one log command and `--workflow-ids` on the next
 * is the exact divergence `spells one concept with one flag name` exists to
 * catch, and nothing about that failure would point back here.
 */
const LOG_LIST_FILTER_FLAGS = {
  workflowIds: { name: 'workflow', list: true },
  folderPaths: FOLDER_PATHS_FLAG,
  triggers: { name: 'trigger', list: true },
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
  // Hidden in favour of the protocol `sim chat` command, which consumes the
  // endpoint as an NDJSON stream so the reply prints as it generates.
  chat: { hidden: true },
  createCredentialConnection: { hidden: true },
  createServiceAccountCredential: { hidden: true },
  getBillingStatus: {
    command: 'billing status',
    allWorkspaces: true,
    // The credit and storage figures are the payer's, and the API returns null
    // for both to a workspace API key. Said here because the three credit
    // fields otherwise render as an unexplained em-dash for exactly the key
    // most people run the CLI with.
    describe:
      'Show billing status and current-period credit usage (credits and storage require an OAuth login or personal API key)',
    fields: [
      { header: 'plan' },
      { header: 'status' },
      { header: 'workspace', path: 'workspaceId' },
      { header: 'period start', path: 'period.start', format: 'timestamp' },
      { header: 'period end', path: 'period.end', format: 'timestamp' },
      { header: 'used credits', path: 'credits.used' },
      { header: 'limit credits', path: 'credits.limit' },
      { header: 'remaining credits', path: 'credits.remaining' },
      // `fields` is what drives table and text output, so the storage quota the
      // API returns beside the credits was visible only in JSON or YAML.
      { header: 'used storage', path: 'storage.usedBytes', format: 'bytes' },
      { header: 'limit storage', path: 'storage.limitBytes', format: 'bytes' },
      { header: 'storage used %', path: 'storage.percentUsed' },
    ],
  },
  listBillingLogs: {
    command: 'billing logs',
    allWorkspaces: true,
    // Which ledger answered depends on the credential, and the counts otherwise read
    // as a bug next to `billing status`. Said in the describe for the reason
    // `billing status` says its own caveat. The trailing parenthetical is what
    // keeps the generated docs heading unchanged.
    describe:
      "List credit usage events (an OAuth login or personal API key reports only your events; a workspace API key reports every member's in aggregate, unattributed)",
    flags: {
      source: { describe: 'Filter by usage source; sim-chat combines Copilot and workspace chat' },
      period: { describe: 'Billing period' },
      startDate: { describe: 'Custom period start (ISO 8601)' },
      endDate: { describe: 'Custom period end (ISO 8601)' },
    },
    // Which ledger answered: a user credential reports only the calling user's
    // events, a workspace key the whole workspace. The difference was silent —
    // same workspace, same window, same flags, a strictly smaller result.
    pageNote: { path: 'scope', label: 'scope' },
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
  // Same overload again for chunks: PATCH `/chunks` is the bulk form of PATCH
  // `/chunks/[chunkId]`.
  bulkUpdateKnowledgeChunks: {
    command: 'knowledge chunks batch-update',
    describe: 'Enable, disable, or delete many chunks at once',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    flags: {
      chunkIds: { name: 'chunk', list: true },
    },
    // `--operation delete` reaches the same destructive path as `knowledge
    // chunks delete`, which is confirm-gated, so the bulk form is gated too.
    // The document batch-update above is not: it only enables or disables.
    //
    // `confirm` is one message for the whole command, and the operation is a
    // flag value, so the gate cannot branch on it here. The message therefore
    // has to be true of an `enable` as well — both are reversible and neither
    // destroys anything. Claiming a possible irreversible delete on every
    // invocation is what teaches the reflexive `--yes` the gate depends on
    // nobody learning.
    confirm:
      'This applies --operation to every named chunk; with --operation delete it deletes them and their embeddings, which cannot be undone.',
  },
  createKnowledgeConnector: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  listKnowledgeConnectors: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  getKnowledgeConnector: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  listKnowledgeConnectorDocuments: {
    command: 'knowledge connectors documents list',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  updateKnowledgeConnector: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  updateKnowledgeConnectorDocuments: {
    command: 'knowledge connectors documents update',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    flags: {
      documentIds: { name: 'document', list: true },
    },
  },
  syncKnowledgeConnector: {
    command: 'knowledge connectors sync',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    describe: 'Queue a knowledge connector synchronization',
  },
  // `DELETE /workflows/[id]/deploy` is an undeploy, not a delete.
  undeployWorkflow: {
    command: 'workflows undeploy',
    describe: 'Take a workflow out of deployment',
    // Nothing about the name says "delete", so the destructive sweep never
    // reached it — yet every consumer of the workflow breaks the moment it
    // runs, the published MCP tools included.
    //
    // The outage is the whole of it: a workflow's MCP registrations are
    // archived rather than deleted, and deploying again republishes it on
    // exactly the servers it was on before. So the message says "until it is
    // deployed again" and claims no permanent loss — a warning that overstates
    // is the same defect as one that is silent, and this gate only works while
    // callers believe it.
    confirm:
      'This takes the workflow offline for every API and chat consumer, and agents calling its MCP tools lose access until it is deployed again.',
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
  // Soft deletes, all three: `tables restore`, `knowledge restore` and
  // `workflows restore` bring the resource back with its contents intact. The
  // messages promised an irreversible loss, which is the one thing a confirm
  // gate must get right — `deleteFile` already says "archives".
  deleteTable: {
    confirm: 'This archives the table and all of its rows; restore with `tables restore`.',
  },
  deleteTableRow: { confirm: 'This deletes the row.' },
  deleteTableColumn: {
    confirm: 'This deletes the column and its values in every row.',
    fields: [{ header: 'remaining columns', path: 'columns', format: 'count' }],
  },
  deleteKnowledgeBase: {
    confirm:
      'This archives the knowledge base and every document in it; restore with `knowledge restore`.',
  },
  deleteKnowledgeDocument: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    confirm: 'This deletes the document and its embeddings.',
  },
  deleteKnowledgeConnector: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
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
  deleteSandbox: {
    confirm: 'This deletes the sandbox; Function blocks that select it fail until re-pointed.',
  },
  deleteMcpServer: {
    confirm: 'This removes the MCP server and the tools it provides.',
  },
  deleteSecret: {
    confirm: 'This deletes the secret; anything using it may stop working.',
  },
  deleteWorkflow: {
    confirm: 'This archives the workflow and its run history; restore with `workflows restore`.',
  },
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
      ...LOG_LIST_FILTER_FLAGS,
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
    // The floors are for `logs follow`, which locks its widths on the first
    // batch and had nothing to measure at `-n 0`. Each is what the column's own
    // rendering needs beyond its header label: an ISO timestamp trimmed to
    // seconds, the longest status and core trigger type, a UUID run id, and a
    // four-decimal cost above ten credits. `workflow` is free text with no
    // bound, so its floor is editorial — enough to tell two runs apart.
    // `duration` carries none: a lock is never narrower than its own header,
    // and `DURATION` is already the eight characters a floor would have asked
    // for.
    columns: [
      { header: 'started', path: 'startedAt', format: 'timestamp', minWidth: 19 },
      { header: 'status', minWidth: 9 },
      { header: 'level' },
      { header: 'trigger', minWidth: 12 },
      { header: 'workflow', path: 'workflow.name', minWidth: 24 },
      { header: 'duration', path: 'totalDurationMs', format: 'duration' },
      { header: 'cost', path: 'cost.total', format: 'cost', minWidth: 8 },
      { header: 'run', path: 'runId', minWidth: 36 },
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
  /**
   * Single-record GETs. `deriveCommandPath` calls a `GET` a `list` unless the
   * path ends in a parameter, so each of these derived to `... list` while
   * returning exactly one thing — the defect already corrected above for
   * `getWorkflowDeployment`. None of these spellings has shipped, so no
   * `renamedFrom` is owed.
   */
  getMeta: {
    command: 'meta status',
    describe: 'Show what this API supports and which limits apply',
  },
  getWorkflowChatDeployment: {
    command: 'workflows chat status',
    describe: 'Show a workflow’s chat deployment',
  },
  getLogStats: {
    command: 'logs stats',
    describe: 'Summarize run counts, failures and latency over a window',
    flags: LOG_LIST_FILTER_FLAGS,
    // Undeclared, the summary fell through to the generic key dump: the whole
    // `workflows` series printed as one truncated line of raw JSON, the window
    // as another, and `avgLatency` as a raw float — the one duration in the
    // response the `Ms` suffix does not rescue.
    fields: [
      { header: 'runs', path: 'totalRuns' },
      { header: 'errors', path: 'totalErrors' },
      { header: 'avg latency', path: 'avgLatency', format: 'duration' },
      { header: 'window start', path: 'timeBounds.start', format: 'timestamp' },
      { header: 'window end', path: 'timeBounds.end', format: 'timestamp' },
      { header: 'bucket width', path: 'segmentMs', format: 'duration' },
      { header: 'workflows', format: 'count' },
      { header: 'workflows truncated', path: 'workflowsTruncated', format: 'bool' },
    ],
  },
  readFileText: {
    command: 'files read',
    describe: 'Read a file’s text content',
  },
  // Publishing a workflow for an outside agent to call, and withdrawing it.
  createWorkflowMcpServer: {
    flags: { workflowIds: { name: 'workflow', list: true } },
  },
  deleteWorkflowMcpServer: {
    confirm: 'This deletes the MCP server, and any agent calling its tools loses access.',
  },
  deployWorkflowMcpTool: {
    flags: {
      parameterDescriptions: { json: true, describe: MCP_PARAMETER_DESCRIPTIONS_HELP },
    },
  },
  // The same miss the comment on `listMcpServers` describes, one family over:
  // undeclared, these dumped every scalar — both timestamps and, on the tools
  // list, `mcpServerUrl` and `apiEndpoint` truncated side by side — while
  // `toolCount`, the field you scan a server list for, came last.
  listWorkflowMcpServers: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'tools', path: 'toolCount' },
      { header: 'public', path: 'isPublic', format: 'bool' },
      { header: 'url', path: 'mcpServerUrl' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  listWorkflowMcpTools: {
    // `workflowId`, not the tool's own id: it is what `tools delete` addresses
    // the tool by.
    columns: [
      { header: 'tool', path: 'toolName' },
      { header: 'workflow', path: 'workflowId' },
      { header: 'description', path: 'toolDescription' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  undeployWorkflowMcpTool: {
    confirm: 'This withdraws the tool, and any agent calling it loses access.',
  },
  duplicateWorkflow: {
    flags: { folderPath: FOLDER_PATH_FLAG },
  },
  // Graph writes. None is delete-shaped by name, so neither destructive sweep
  // reaches them, yet each can discard work: a state replace overwrites the
  // whole draft with no conflict detection, an operations batch carries a
  // `delete` arm, and a variables patch replaces the set.
  /**
   * The derived names read wrong here. `deriveCommandPath` calls a `GET` a
   * `list` unless the path ends in a parameter, but `/workflows/[id]/state` is
   * one graph, not a page of them; and `POST` derives to `create`, which
   * describes neither replacing a graph nor applying a batch of edits to one.
   * Each name is the operation's own verb instead.
   */
  getWorkflowState: { command: 'workflows state get' },
  replaceWorkflowState: {
    command: 'workflows state replace',
    confirm: 'This replaces the entire draft graph and cannot be undone.',
  },
  applyWorkflowOperations: {
    command: 'workflows operations apply',
    confirm: 'This edits the draft graph, and a delete operation removes blocks and their edges.',
    flags: {
      operations: { json: true, describe: WORKFLOW_OPERATIONS_HELP },
      setBlockEnabled: { json: true, describe: WORKFLOW_SET_BLOCK_ENABLED_HELP },
    },
  },
  applyWorkflowVariables: {
    confirm: 'This replaces the workflow’s variables and cannot be undone.',
    flags: {
      operations: { json: true, describe: WORKFLOW_VARIABLE_OPERATIONS_HELP },
    },
  },
  // A revert is a graph write too: it overwrites the draft with an older
  // deployment's graph. Nothing about the name says "delete", so the destructive
  // sweep does not reach it, and the work it discards is whatever is in the
  // draft right now.
  revertWorkflowVersion: {
    confirm: 'This overwrites the draft graph with the selected version and cannot be undone.',
  },
  // A rollback is the deployed counterpart of that revert, and the more
  // consequential of the two: a revert only rewrites the draft, while this
  // changes which version production serves. Gating the draft write and not the
  // live one had it backwards.
  rollbackWorkflow: {
    confirm:
      'This changes which deployed version runs in production for every API and chat consumer.',
  },
  // The same application operation as `rollback`, under a different transition:
  // both switch production away from the version the caller last chose. Gating
  // one and not the other was an accident of naming, not a policy.
  activateWorkflowVersion: {
    confirm:
      'This changes which deployed version runs in production for every API and chat consumer.',
  },
  // POST derives to `... create`, which creates nothing here. Named for the
  // operation instead, matching the shipped `files move`.
  moveWorkflows: {
    command: 'workflows move',
    flags: {
      workflowIds: { name: 'workflow', list: true },
      // The destination, which its two siblings both spell `--to`. Under
      // `--folder` it read as the selection being moved — the sense the flag
      // of that name genuinely has one command over, on `tables move`.
      folderPath: {
        ...FOLDER_PATH_INPUT,
        name: 'to',
        renamedFrom: ['folder'],
        describe: 'Destination folder path; / moves the workflows to the workspace root',
      },
    },
  },
  moveTables: {
    command: 'tables move',
    flags: {
      // Folders being moved, not a destination: the generic path blurb the
      // shared constant carries answers the format question and leaves the
      // one that matters beside `--to`.
      folderPaths: {
        ...FOLDER_PATHS_FLAG,
        describe: 'Table folders to move, by path as shown in the app; the leading / is optional',
      },
      targetFolderPath: TARGET_FOLDER_PATH_FLAG,
    },
  },
  // `PATCH /rows` is already the filter form (`updateRowsByFilter`,
  // one payload applied to every match). This is the AIP-234 batch — a distinct
  // payload per listed row — so it needs a name that says "each", not a second
  // `batch-`/`bulk-` spelling one word apart from its neighbour.
  bulkUpdateTableRows: {
    command: 'tables rows update-each',
    describe: 'Apply a distinct patch to each listed row',
  },
  bulkDeleteTables: {
    // `batch-`, not `bulk-`: `tables delete` exists, so this is the same
    // collision rename as `files batch-delete` above and takes the same word.
    command: 'tables batch-delete',
    flags: { folderPaths: FOLDER_PATHS_FLAG },
    confirm: 'This deletes every listed table and all of their rows.',
  },
  searchFileContent: {
    flags: {
      folderPaths: {
        ...FOLDER_PATHS_FLAG,
        describe:
          'Folders to search, by path as shown in the app; omit to search the whole workspace',
      },
      includeSubfolders: {
        boolean: true,
        negatable: true,
        describe: 'Whether each folder scope includes nested folders; on by default',
      },
    },
    itemsPath: 'results',
    columns: [
      { header: 'file', path: 'fileId' },
      { header: 'line', path: 'lineNumber' },
      { header: 'text' },
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
  // A dependency set is typed one specifier at a time or pasted from a
  // requirements file, so each list takes space-separated values or `@path`
  // with one entry per line rather than a JSON array. The package lists are
  // manifests: a requirements file carries blank lines and `#` comments, which
  // the API ignores, so the reader drops them instead of refusing the file.
  createSandbox: {
    flags: {
      dependencies: { list: true, manifest: true },
      cliTools: { list: true },
      systemPackages: { list: true, manifest: true },
    },
  },
  updateSandbox: {
    flags: {
      dependencies: { list: true, manifest: true },
      cliTools: { list: true },
      systemPackages: { list: true, manifest: true },
    },
  },

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
    flags: {
      folderPath: FOLDER_PATH_FLAG,
      // The same server-side string union as the four folder deletes, and the
      // one place the terminal override was missed: `--recursive` alone read
      // as "argument missing" and only `--recursive yes` worked, on the flag
      // spelled as a bare switch everywhere else in the CLI.
      // Unlike the folder deletes, this one is on unless told otherwise: the
      // API turns it on as soon as `--search` is set, so the negation is the
      // only way to search a folder without descending into it.
      recursive: { boolean: true, negatable: true },
    },
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
  updateKnowledgeDocument: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    // `retryProcessing` is `z.literal(true)` and must travel alone, so the
    // generated `--no-retry-processing` sends `retryProcessing: false` as the
    // whole request: a payload that asks for nothing and that the route
    // rejects. `boolean` suppresses the negation.
    flags: { retryProcessing: { boolean: true } },
  },
  listKnowledgeTags: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  createKnowledgeTag: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    flags: {
      // The default is silent in help, and it is the field a rejected
      // `--tag-slot` is blamed on: `--tag-slot number3` alone fails with `not
      // valid for field type "text"`, naming a type the caller never typed.
      fieldType: {
        describe:
          'Value type stored in the slot; it decides which slots are usable and which filter operators apply. Defaults to text, so a number, date, or boolean slot must name its type here. Slot capacity per type: text 7, number 5, date 2, boolean 3',
      },
    },
  },
  updateKnowledgeTag: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  deleteKnowledgeTag: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    confirm: 'This deletes the tag and clears its values on every document and chunk.',
  },
  // Both derive off their trailing segment (`knowledge next-slot list`,
  // `knowledge usage list`), which loses the `tags` group they belong to and
  // reads as a resource the API does not have.
  getNextKnowledgeTagSlot: {
    command: 'knowledge tags next-slot',
    describe: 'Show which tag slot a create would take for a field type',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  listKnowledgeTagUsage: {
    command: 'knowledge tags usage',
    describe: 'Show how many documents and chunks carry each tag',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
  },
  addWorkspaceFilesToKnowledgeBase: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    describe: 'Index files the workspace already stores',
    flags: {
      fileReferences: {
        name: 'file',
        list: true,
        describe: 'Workspace file ID or key (repeatable)',
      },
    },
  },
  listKnowledgeChunks: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    columns: [
      { header: 'id' },
      { header: 'index', path: 'chunkIndex' },
      { header: 'tokens', path: 'tokenCount' },
      { header: 'enabled' },
    ],
  },
  createKnowledgeChunk: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  getKnowledgeChunk: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  updateKnowledgeChunk: { pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT },
  deleteKnowledgeChunk: {
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    confirm: 'This deletes the chunk and its embedding.',
  },
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
      // `title` and `schema.function.name` are both real and different fields
      // on this resource — the flags say `--search` matches the title and
      // `--sort-by title` orders by it — so a column headed `name` showing the
      // title named the other one.
      { header: 'title', path: 'title' },
      { header: 'description', path: 'schema.function.description' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    ],
  },
  listSandboxes: {
    columns: [
      { header: 'id' },
      { header: 'name' },
      { header: 'language' },
      // `builtAt` is null under a runtime-install deployment, so the build
      // state and the last edit are what every row can show.
      { header: 'status', path: 'buildStatus' },
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
    // `description` and `unredacted` trail the existing columns: `--output
    // text` is positional, so inserting ahead of `updated` would shift every
    // field a script already cuts.
    //
    // `unredacted` is the one property of a secret an operator has to be able
    // to see from a listing: it means the stored value appears in plaintext in
    // run logs, model-visible content, and publicly shared log links. Omitting
    // it left the table and text formats — the defaults — unable to answer
    // which secrets are in that state at all.
    columns: [
      { header: 'name' },
      { header: 'scope' },
      { header: 'role' },
      { header: 'updated', path: 'updatedAt', format: 'timestamp' },
      { header: 'description' },
      { header: 'unredacted', format: 'bool' },
    ],
  },
  getWorkspace: {
    profileWorkspacePath: true,
    // `mode` is not a field of the strict v2 workspace schema, so it rendered
    // an em-dash on every call; `color` and `logoUrl` are returned and were the
    // two the record left out.
    fields: [
      { header: 'id' },
      { header: 'name' },
      { header: 'color' },
      { header: 'logo', path: 'logoUrl' },
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
        describe:
          'Organization ID; defaults to your only organization, and is required when your account belongs to more than one (OAuth login or personal API key required)',
      },
    },
    columns: [
      { header: 'at', path: 'createdAt', format: 'timestamp' },
      { header: 'workspace', path: 'workspaceId' },
      { header: 'actor', path: 'actorEmail' },
      { header: 'action' },
      { header: 'resource', path: 'resourceName' },
      // `audit-logs get` takes this id, and the listing is the only place to
      // read one — the same reason `logs list` renders `run`.
      { header: 'id' },
    ],
  },
  getAuditLog: {
    flags: {
      organizationId: {
        name: 'organization',
        describe:
          'Organization ID; defaults to your only organization, and is required when your account belongs to more than one (OAuth login or personal API key required)',
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
      { header: 'web URL', path: 'webUrl' },
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
      targetFolderPath: TARGET_FOLDER_PATH_FLAG,
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
  // Left to derive, the folder restore lands under `files restore` and turns
  // that leaf back into a group holding a lone `create` — the exact shape the
  // rename above exists to remove. It belongs beside the other folder verbs.
  restoreFileFolder: {
    command: 'files folders restore',
    positionals: ['path'],
    flags: { path: FOLDER_PATH_INPUT },
    describe: 'Restore an archived file folder',
  },
  /**
   * The restore family mirrors `restoreFile`/`restoreFileFolder` above: a
   * `restore create` created nothing, and leaving the folder restore to derive
   * collides with the resource restore on the same leaf.
   */
  restoreTable: {
    command: 'tables restore',
    describe: 'Restore an archived table',
  },
  restoreTableFolder: {
    command: 'tables folders restore',
    positionals: ['path'],
    flags: { path: FOLDER_PATH_INPUT },
    describe: 'Restore an archived table folder',
  },
  restoreKnowledgeBase: {
    command: 'knowledge restore',
    describe: 'Restore an archived knowledge base',
  },
  restoreWorkflow: {
    command: 'workflows restore',
    describe: 'Restore an archived workflow',
  },
  cancelTableDispatch: {
    // `delete` reads as removing a record; this stops a run that is under way.
    command: 'tables dispatches cancel',
    describe: 'Cancel a running dispatch',
    confirm:
      'This stops the dispatch. Cells already handed to the queue keep running — use `tables cancel-runs` to stop those.',
  },
  replaceWorkflowChatDeployment: {
    command: 'workflows chat publish',
    describe: 'Publish or replace a workflow’s chat deployment',
    confirm:
      'This replaces the chat deployment wholesale. Any field you omit returns to its default, including a stored password or allow-list.',
  },
  deleteWorkflowChatDeployment: {
    command: 'workflows chat unpublish',
    describe: 'Take a workflow’s chat deployment offline',
    confirm:
      'This takes the chat offline and frees its identifier. The workflow itself stays deployed and executable.',
  },
  /**
   * Both write the knowledge base's tag vocabulary, so they sit beside the
   * per-definition `tags update`/`tags delete` rather than deriving onto them.
   */
  bulkSaveKnowledgeTagDefinitions: {
    command: 'knowledge tags save',
    describe: 'Declare the tag definitions a knowledge base needs',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    flags: {
      definitions: { json: true, describe: KNOWLEDGE_TAG_DEFINITIONS_HELP },
    },
  },
  deleteKnowledgeTagDefinitions: {
    command: 'knowledge tags cleanup',
    pathArgumentNames: KNOWLEDGE_BASE_PATH_ARGUMENT,
    describe: 'Remove tag definitions no document still uses',
    flags: {
      // The API's own prose names a wire spelling the terminal does not have:
      // there is no `unused=false` to pass, and the flag that does it is
      // `--no-unused`, printed on the very next line of the same help.
      unused: {
        describe:
          'Whether to remove only the tag definitions no document in the knowledge base still carries a value for. Defaults to true. Pass --no-unused to delete every definition on the knowledge base, which also clears its slot on every document and chunk and is not recoverable',
      },
    },
    confirm:
      'This deletes every tag definition no document still uses. Their slots become free for a different field.',
  },
  unzipFile: {
    // `files unzip create` created nothing; the verb is the whole command.
    command: 'files unzip',
    describe: 'Unzip an archive into a new folder beside it',
    confirm: 'This writes every file in the archive into the workspace.',
  },
  /**
   * Configured even though `buildGeneratedCommands` skips it: it only builds
   * operations whose `responseMode` is `json` (runtime/build.ts), so this
   * zip-streaming endpoint has no command today. The entry is not inert — the
   * contract sweeps read it, and `folderPaths` must be marked for encoding
   * here or `folder-path fields` fails.
   */
  bulkDownloadFiles: {
    command: 'files bulk-download',
    describe: 'Download files and folders as a zip archive',
    flags: {
      fileIds: { list: true },
      folderPaths: FOLDER_PATHS_FLAG,
    },
  },
  editFileContent: {
    command: 'files edit',
    describe: 'Apply one exact or anchor-based edit to a text file',
    flags: {
      edit: { describe: FILE_EDIT_HELP },
    },
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
  /**
   * None of the four folder lists paginates: the route declares no `cursor` and
   * answers with the whole set. That is deliberate — a folder tree is bounded
   * where it loads — but the terminal said nothing about it, and a caller
   * reading `--limit` on every other `list` had no way to tell whether the
   * answer was the full set or the first page of one.
   */
  listFileFolders: {
    describe: 'List folders',
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  listKnowledgeFolders: {
    describe: 'List knowledge folders',
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  listTableFolders: {
    describe: 'List table folders',
    aliases: ['ls'],
    flags: {
      parentPath: { ...FOLDER_PATH_INPUT, name: 'parent', describe: 'Direct parent folder path' },
    },
    columns: FOLDER_LIST_COLUMNS,
  },
  listWorkflowFolders: {
    describe: 'List workflow folders',
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
  // `/cancel-runs`, `/rows/search`, `/query/count` and the
  // enrichment path all put a verb where the deriver expects a sub-resource, so
  // each became a group holding a lone `create`.
  cancelTableRuns: {
    command: 'tables cancel-runs',
    describe: 'Stop every running column job',
    flags: {
      excludeRowIds: { list: true },
      filter: { json: true, describe: TABLE_FILTER_HELP },
    },
    // `tables dispatches cancel` gates one dispatch; this stops every run on
    // the table at once and was the ungated one of the pair. The message has
    // to hold for `--scope row` too, so it names the scope rather than
    // claiming the whole table every time.
    confirm:
      'This cancels running column jobs — the whole table with --scope all, one row with --scope row.',
  },
  searchTableRows: {
    command: 'tables rows search',
    renamedFrom: ['tables rows find'],
    describe: 'Search cells for a value and return their coordinates',
    flags: {
      // `--q` was the wire field spelled out; the same idea is `--query` on
      // `knowledge search`, and one concept should not have two flag names.
      q: { name: 'query', renamedFrom: ['q'], describe: 'Value to search for' },
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
  createTableDispatch: {
    command: 'tables dispatches create',
    renamedFrom: ['tables columns run'],
    describe: 'Start a column or enrichment run',
    flags: {
      groupIds: { list: true },
      rowIds: { list: true },
      excludeRowIds: { list: true },
      filter: { json: true, describe: TABLE_FILTER_HELP },
      // Every other `--limit` in the CLI is a page size typed as a bare
      // integer, so this one — an object naming the unit it caps — answered
      // `--limit 2` with "expected object, received number" and the flag name
      // was the reason anyone typed that. Renamed to say what it caps, and
      // typed as the count it reads as: `rowCap` builds the object the route
      // wants. `--limit` still resolves for an existing script.
      limit: {
        name: 'max-rows',
        renamedFrom: ['limit'],
        rowCap: true,
        describe: DISPATCH_ROW_LIMIT_HELP,
      },
    },
  },
  listTableDispatches: {
    // Column inference drops every object-valued field, so `scope` — the whole
    // point of the row — was invisible, and `limit` appeared or vanished with
    // whether the first row happened to be capped. Declared instead, with the
    // scope broken into the scalars that distinguish a plain dispatch from a
    // filtered or select-all-minus one. `tableId` and `workspaceId` are gone:
    // both are already the command's own arguments. The rest keep the order
    // inference gave them and the scope columns are appended, because
    // `--output text` is positional and a script may be cutting fields.
    columns: [
      { header: 'id' },
      { header: 'status' },
      { header: 'mode' },
      // The cap is `{ type, max } | null`, and only `max` is a value: `type` is
      // a `z.literal('rows')` that says the same thing on every row.
      { header: 'max rows', path: 'limit.max' },
      { header: 'processed', path: 'processedCount' },
      { header: 'manual', path: 'isManualRun', format: 'bool' },
      { header: 'requested', path: 'requestedAt', format: 'timestamp' },
      { header: 'completed', path: 'completedAt', format: 'timestamp' },
      { header: 'canceled', path: 'canceledAt', format: 'timestamp' },
      { header: 'groups', path: 'scope.groupIds', format: 'count' },
      { header: 'rows', path: 'scope.rowIds', format: 'count' },
      { header: 'filtered', path: 'scope.filtered', format: 'bool' },
      { header: 'excluded', path: 'scope.excludeRowIds', format: 'count' },
    ],
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
  // `get` and `cancel` stay, but not the upload token they also accept. It
  // addresses an import mid-transfer, and `sim tables import` never leaves one
  // in that state: the command drives the whole handshake and aborts the
  // session if any part of it fails. An import a CLI caller can still name is
  // an import their API key and workspace already reach, which is the branch
  // `resolveTableImportContext` takes when no token is sent — so the flag adds
  // a credential to type and no import it reaches.
  getTableImport: { flags: TRANSFER_TOKEN_OMITTED },
  cancelTableImport: {
    command: 'tables imports cancel',
    flags: TRANSFER_TOKEN_OMITTED,
    describe: 'Stop a running import',
    // Gated for the reason `tables dispatches cancel` is: the runner commits
    // rows batch by batch and its ownership gate stops it between batches, so
    // there is never a state to resume from. The message has to hold for both
    // modes, and `replace` is the destructive one — it empties the table before
    // its first batch, so a cancelled replace leaves neither the old rows nor
    // the whole file.
    confirm:
      'This stops the import between row batches, so whatever it already wrote stays and nothing resumes it. A replace import empties the table before its first batch, so cancelling one leaves only part of the new file; an append adds its rows again if you import the file a second time.',
  },
  cancelTableExport: {
    command: 'tables exports cancel',
    describe: 'Stop a running export',
    // Not `confirm`-gated: the export only reads the table and writes a file
    // nobody has yet, so cancelling discards nothing `tables exports create`
    // cannot redo.
  },
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

  // ─── Catalog ──────────────────────────────────────────────────────────────
  // `tools get` and `tools list` derive cleanly; only the verb needs naming, for
  // the same reason `workflows run` does — `/execute` is not in the action list,
  // so POST would derive `tools execute create`.
  executeTool: {
    command: 'tools execute',
    describe: 'Run one built-in tool and print what it produced',
    flags: {
      // Named `input` to match `workflows run --input`, the only other command
      // that hands arguments to something Sim runs. `@file` and `@-` come from
      // the JSON kind, so a payload too awkward to quote can be piped in.
      input: {
        json: true,
        describe:
          'Tool arguments as JSON, keyed by the parameter ids `sim tools get <toolId>` lists',
      },
      // Spelled `--credential-id`, the derived name, because `knowledge
      // connectors create` already takes the same field under it and the
      // contract holds one flag name per concept.
      credentialId: { describe: 'Credential to authenticate with, required for OAuth tools' },
      timeoutSeconds: { name: 'timeout', describe: 'Seconds to wait before abandoning the call' },
    },
    fields: [
      { path: 'toolId', header: 'Tool' },
      { path: 'status', header: 'Status' },
      // The command's whole purpose. Human formats one-line and clamp it, which
      // is why `--output json` exists; omitting it entirely printed a status and
      // nothing the caller asked for.
      { path: 'output', header: 'Output' },
      { path: 'error.message', header: 'Error' },
    ],
  },

  // ─── Runs ─────────────────────────────────────────────────────────────────
  // The derived names land badly here: `/execute` and `/cancel` are verbs in
  // the path, but neither is in the action list, so POST would derive
  // `workflows execute create` and `workflows cancel create`.
  executeWorkflow: {
    command: 'workflows run',
    describe: 'Run a deployed workflow or execute saved state manually',
    flags: {
      async: { boolean: true, describe: 'Queue the run and return immediately' },
      input: { json: true, describe: 'Trigger input as JSON' },
      run: {
        hidden: true,
        describe: 'Low-level workflow state and entry-point selection',
      },
      // Stream-only on the wire, so the requirement is stated where the flag
      // is read rather than left to the 400. The dialect differs from the one
      // `workflows runs get` takes, which is why both describes name theirs.
      selectedOutputs: {
        name: 'select-output',
        list: true,
        describe:
          'Return streamed outputs as blockName.path or childWorkflowId.blockName.path; selecting a child workflow applies to every invocation, requires --follow',
      },
      // SSE, not JSON — the generic client cannot consume it, so the response
      // encoding is chosen by `--follow`, which `workflow-run-follow.ts` adds to
      // this same leaf and renders by hand. These stay omitted because sending
      // them down the generated path would still break it.
      stream: { omit: true },
      includeThinking: { omit: true },
      includeToolCalls: { omit: true },
      // Exposed under its domain name: every other flag in the CLI is one, and
      // `--x-run-id` would be the only place the raw HTTP header spelling
      // surfaced. The describe denies idempotency outright because the name
      // reads like an idempotency key and the header is not one: neither reusing
      // a value nor picking a fresh one makes a retry safe.
      'x-run-id': {
        name: 'run-id',
        describe:
          'One-shot identifier for this run; NOT an idempotency key — reusing a claimed value fails with RUN_ID_CONFLICT instead of replaying the first result, and a fresh value starts another run',
      },
      // The call-chain marker Sim writes for itself on a workflow-to-workflow
      // hop. A CLI invocation is always the first hop, so the only thing a flag
      // for it could do is forge a chain the caller was never part of.
      'x-sim-via': { omit: true },
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
      // A finished run is read back without loading the workflow, so the
      // recorded block ids are all there is to match against — the block names
      // `workflows run --select-output` accepts are rejected here.
      selectedOutputs: {
        name: 'select-output',
        list: true,
        describe:
          'Include blockId or blockId.path values in JSON or YAML output; block names are not resolved on a finished run',
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
    // Not `confirm`-gated: the whole point is to stop something that is
    // already going wrong, and for an ordinary in-flight run `re-run it` is a
    // real recovery. It is NOT one for a run paused for input — cancelling
    // flips the paused row to `cancelled`, and nothing resumes from that
    // status, so the snapshot is kept but `workflows runs resume` can never
    // take it again and starting over repeats every side effect the run
    // already performed. Gating it is a live proposal rather than an
    // oversight; it is left ungated here because `confirm` is all-or-nothing
    // and cancel is the command most likely to be automated.
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
  // Inspecting a session goes with them, for a reason the other steps do not
  // share: it is addressed by a *required* upload token, and `sim files upload`
  // completes the session on success and aborts it on failure, so no session
  // outlives the command and no caller is left holding a token to ask with.
  // Left visible it read as a working command that answered every invocation
  // with `--upload-token is required` and no way to satisfy it.
  getFileUpload: { hidden: true },
}
