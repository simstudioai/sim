import { ClaudeIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/** Operations this block exposes, each backed by one tool. */
type ManagedAgentOperation =
  | 'run_session'
  | 'create_session'
  | 'send_message'
  | 'get_session'
  | 'list_events'
  | 'update_session'
  | 'interrupt_session'
  | 'respond_tool_confirmation'
  | 'respond_custom_tool'
  | 'archive_session'
  | 'delete_session'

/**
 * The behavior the block had before the operation selector existed. Blocks
 * saved back then have NO stored `operation` value, so every code path that
 * reads it must fall back to this — see {@link forOperations}.
 */
const DEFAULT_OPERATION: ManagedAgentOperation = 'run_session'

const OPERATION_TOOL_IDS: Record<ManagedAgentOperation, string> = {
  run_session: 'managed_agent_run_session',
  create_session: 'managed_agent_create_session',
  send_message: 'managed_agent_send_message',
  get_session: 'managed_agent_get_session',
  list_events: 'managed_agent_list_events',
  update_session: 'managed_agent_update_session',
  interrupt_session: 'managed_agent_interrupt_session',
  respond_tool_confirmation: 'managed_agent_respond_tool_confirmation',
  respond_custom_tool: 'managed_agent_respond_custom_tool',
  archive_session: 'managed_agent_archive_session',
  delete_session: 'managed_agent_delete_session',
}

/**
 * A value no stored `operation` can ever equal. Compared with `not` it forces a
 * condition true; compared plainly it forces one false.
 */
const NEVER_MATCHES = 'managed-agent-never'

/** The object form of a sub-block condition, as returned by a condition function. */
interface ConditionObject {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: {
    field: string
    value: string | number | boolean | Array<string | number | boolean> | undefined
    not?: boolean
  }
}

/**
 * Builds a `condition` that shows a sub-block only for the given operations.
 *
 * Conditions are evaluated against RAW stored values, and a block saved before
 * the operation selector existed has no `operation` value at all — so a plain
 * `{ field: 'operation', value: 'run_session' }` would evaluate false and make
 * every field on those blocks vanish from the editor. Normalizing the missing
 * value to {@link DEFAULT_OPERATION} here, then collapsing the result to a
 * forced-true/forced-false condition, keeps those blocks rendering exactly as
 * they did while still gating the new operations.
 *
 * `extra` is returned in place of the forced-true condition when the operation
 * matches, which is how an operation gate composes with a field's own
 * condition (e.g. cloud-only fields).
 */
function forOperations(
  operations: readonly ManagedAgentOperation[],
  extra?: ConditionObject
): (values?: Record<string, unknown>) => ConditionObject {
  return (values) => {
    const stored = values?.operation
    const current =
      typeof stored === 'string' && stored.length > 0
        ? (stored as ManagedAgentOperation)
        : DEFAULT_OPERATION
    if (!operations.includes(current)) return { field: 'operation', value: NEVER_MATCHES }
    return extra ?? { field: 'operation', value: NEVER_MATCHES, not: true }
  }
}

/** Operations that build a brand-new session and so take the full agent config. */
const SESSION_STARTING_OPERATIONS = ['run_session', 'create_session'] as const

/** Operations that address an existing session by id. */
const SESSION_TARGETING_OPERATIONS = [
  'send_message',
  'get_session',
  'list_events',
  'update_session',
  'interrupt_session',
  'respond_tool_confirmation',
  'respond_custom_tool',
  'archive_session',
  'delete_session',
] as const

/**
 * Claude Managed Agents block.
 *
 * Covers the Managed Agents session lifecycle as selectable operations. The
 * default, Run Session, is the original blocking behavior: create a session,
 * send one message, wait for the agent to finish, return its text. The other
 * operations treat a session as a durable resource addressed by id, which is
 * what a conversational or webhook-driven integration needs — create without
 * waiting, send follow-up turns across separate workflow runs, read state,
 * answer permission gates, and clean up.
 *
 * Both environment models are supported: the Environment type selector filters
 * the environment list and shows only the fields that apply — memory stores and
 * files are cloud-only (self-hosted rejects the `resources` attach), while
 * session metadata works for both.
 *
 * Authentication is a selectable Claude Platform credential (an Anthropic
 * workspace API key). The credential's key is resolved server-side at run
 * time and never enters the block config or the browser.
 */
export const ManagedAgentBlock: BlockConfig = {
  type: 'managed_agent',
  name: 'Claude Managed Agents',
  description: 'Run a Claude Platform Managed Agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    "Invoke a Claude Platform Managed Agent from a workflow. Select a Claude Platform account, pick an agent and environment from that workspace, optionally attach vaults, a memory store, and files, and add metadata tags. Returns the assistant's final text.",
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/managed_agent',
  bgColor: '#DA7756',
  iconColor: '#DA7756',
  icon: ClaudeIcon,
  canvasPresentation: {
    defaultTitle: 'Claude Managed Agents',
    sentences: {
      byOperation: {
        run_session: [
          { text: 'Run', field: 'agent', core: true },
          { text: 'on', field: 'userMessage' },
        ],
        create_session: [
          {
            text: 'Create a session for',
            field: 'agent',
            core: true,
          },
          { text: 'in', field: 'environment' },
        ],
        send_message: [
          { text: 'Send', field: 'userMessage', core: true },
          { text: 'to session', field: 'sessionId', core: true },
        ],
        get_session: [
          {
            text: 'Read the status of session',
            field: 'sessionId',
            core: true,
          },
        ],
        list_events: [
          {
            text: 'Read the event history of session',
            field: 'sessionId',
            core: true,
          },
          { text: ', up to', field: 'limit', after: 'events' },
        ],
        update_session: [
          {
            text: 'Update session',
            field: 'sessionId',
            core: true,
          },
          { text: ', renaming it to', field: 'title' },
        ],
        interrupt_session: [
          {
            text: 'Stop the run in session',
            field: 'sessionId',
            core: true,
          },
        ],
        respond_tool_confirmation: [
          {
            text: 'Set pending tool calls in session',
            field: 'sessionId',
            core: true,
          },
          { text: 'to', field: 'decision' },
        ],
        respond_custom_tool: [
          { text: 'Return', field: 'result', core: true },
          { text: 'to tool call', field: 'customToolUseId', core: true },
        ],
        archive_session: [
          {
            text: 'Archive session',
            field: 'sessionId',
            core: true,
          },
        ],
        delete_session: [
          {
            text: 'Permanently delete session',
            field: 'sessionId',
            core: true,
          },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Claude Platform account',
      type: 'oauth-input',
      serviceId: 'claude-platform',
      credentialKind: 'service-account',
      required: true,
      placeholder: 'Select a Claude Platform credential',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Run session (create, send, wait for reply)', id: 'run_session' },
        { label: 'Create session', id: 'create_session' },
        { label: 'Send message', id: 'send_message' },
        { label: 'Get session', id: 'get_session' },
        { label: 'List events', id: 'list_events' },
        { label: 'Update session', id: 'update_session' },
        { label: 'Interrupt session', id: 'interrupt_session' },
        { label: 'Respond to tool confirmation', id: 'respond_tool_confirmation' },
        { label: 'Respond to custom tool', id: 'respond_custom_tool' },
        { label: 'Archive session', id: 'archive_session' },
        { label: 'Delete session', id: 'delete_session' },
      ],
      value: () => DEFAULT_OPERATION,
      description:
        'Run session blocks until the agent replies. The other operations act on a session by id, so a conversation can span multiple workflow runs.',
    },
    {
      id: 'sessionId',
      title: 'Session ID',
      type: 'short-input',
      required: true,
      placeholder: 'sesn_...',
      condition: forOperations(SESSION_TARGETING_OPERATIONS),
      description: 'The session to act on, e.g. from a Create Session block or stored metadata.',
    },
    {
      id: 'environmentType',
      title: 'Environment type',
      type: 'dropdown',
      canonicalParamId: 'environmentType',
      required: true,
      condition: forOperations(SESSION_STARTING_OPERATIONS),
      options: [
        { label: 'Cloud', id: 'cloud' },
        { label: 'Self-hosted', id: 'self_hosted' },
      ],
      value: () => 'cloud',
      description:
        'Self-hosted environments run on your own infrastructure and route memory via session metadata; file attachments are cloud-only.',
    },
    {
      id: 'agent',
      title: 'Agent',
      type: 'combobox',
      selectorKey: 'managedAgent.agents',
      required: true,
      placeholder: 'Select an agent from your Claude workspace…',
      commandSearchable: true,
      dependsOn: ['credential'],
      condition: forOperations(SESSION_STARTING_OPERATIONS),
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'combobox',
      selectorKey: 'managedAgent.environments',
      required: true,
      placeholder: 'Select an environment…',
      commandSearchable: true,
      dependsOn: ['credential', 'environmentType'],
      condition: forOperations(SESSION_STARTING_OPERATIONS),
    },
    {
      id: 'userMessage',
      title: 'User message',
      // Optional only for Create Session, where omitting it creates the session
      // without starting the agent. Required everywhere else it is shown.
      required: { field: 'operation', value: 'create_session', not: true },
      type: 'long-input',
      placeholder: 'Ask the Managed Agent to do something…',
      condition: forOperations(['run_session', 'create_session', 'send_message']),
    },
    {
      id: 'eventTypes',
      title: 'Event types',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — e.g. agent.message',
      condition: forOperations(['list_events']),
      description: 'Comma-separated event-type filter. Leave empty to return every event.',
    },
    {
      id: 'limit',
      title: 'Max events',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: '500',
      condition: forOperations(['list_events']),
      description:
        'Caps how many events are returned. A long session can have thousands, so leave this bounded unless you need the full history.',
    },
    {
      id: 'toolUseIds',
      title: 'Tool use event IDs',
      type: 'short-input',
      required: true,
      placeholder: 'sevt_...',
      condition: forOperations(['respond_tool_confirmation']),
      description:
        'Comma-separated blocking event ids, from a Get Session block’s pendingTools[].id.',
    },
    {
      id: 'decision',
      title: 'Decision',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Allow', id: 'allow' },
        { label: 'Deny', id: 'deny' },
      ],
      value: () => 'allow',
      condition: forOperations(['respond_tool_confirmation']),
    },
    {
      id: 'denyMessage',
      title: 'Deny reason',
      type: 'long-input',
      required: false,
      placeholder: 'Why the agent may not run this tool…',
      condition: forOperations(['respond_tool_confirmation'], { field: 'decision', value: 'deny' }),
      description: 'Surfaced to the agent so it can adjust its approach.',
    },
    {
      id: 'customToolUseId',
      title: 'Custom tool use event ID',
      type: 'short-input',
      required: true,
      placeholder: 'sevt_...',
      condition: forOperations(['respond_custom_tool']),
      description:
        'One id from a Get Session block’s pendingTools[] where kind is custom_tool_result. Each pending tool has its own result, so answer them one at a time.',
    },
    {
      id: 'result',
      title: 'Tool result',
      type: 'long-input',
      required: true,
      placeholder: "The custom tool's output, returned to the agent…",
      condition: forOperations(['respond_custom_tool']),
    },
    {
      id: 'isError',
      title: 'Return as an error',
      type: 'switch',
      required: false,
      condition: forOperations(['respond_custom_tool']),
      description: 'Tells the agent the tool failed so it can adjust its approach.',
    },
    {
      id: 'clearMetadata',
      title: 'Clear metadata',
      type: 'switch',
      required: false,
      condition: forOperations(['update_session']),
      description:
        "Removes all of the session's stored metadata. An empty metadata table alone leaves it unchanged.",
    },
    {
      id: 'title',
      title: 'Session title',
      type: 'short-input',
      required: false,
      placeholder: 'Optional — new title for the session',
      condition: forOperations(['update_session']),
    },
    {
      id: 'vaults',
      title: 'Credential vaults',
      type: 'dropdown',
      selectorKey: 'managedAgent.vaults',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — pick zero or more OAuth vaults',
      searchable: true,
      multiSelect: true,
      dependsOn: ['credential'],
      condition: forOperations(SESSION_STARTING_OPERATIONS),
    },
    {
      id: 'vaultsAck',
      title:
        'I own or am authorized to use these vaults. I understand this means this agent can assume the identity granted by them.',
      type: 'switch',
      required: false,
      mode: 'advanced',
      condition: forOperations(SESSION_STARTING_OPERATIONS),
      description: 'Required when at least one vault is selected above.',
    },
    {
      id: 'memoryStoreId',
      title: 'Memory store',
      type: 'combobox',
      selectorKey: 'managedAgent.memoryStores',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — pick a memory store',
      commandSearchable: true,
      dependsOn: ['credential'],
      // Cloud only: memory stores attach as `resources[]`, which self-hosted
      // rejects. A self-hosted worker that uses a store reads its id from a
      // Metadata key the author sets explicitly.
      condition: forOperations(SESSION_STARTING_OPERATIONS, {
        field: 'environmentType',
        value: 'cloud',
      }),
    },
    {
      id: 'memoryAccess',
      title: 'Memory access',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Read + write (default)', id: 'read_write' },
        { label: 'Read only', id: 'read_only' },
      ],
      value: () => 'read_write',
      condition: forOperations(SESSION_STARTING_OPERATIONS, {
        field: 'memoryStoreId',
        value: '',
        not: true,
        and: { field: 'environmentType', value: 'cloud' },
      }),
      description: 'read_write pushes changes back on session exit; read_only never writes.',
    },
    {
      id: 'memoryInstructions',
      title: 'Memory instructions',
      type: 'long-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — how the agent should use this memory store',
      // Cloud only: instructions are a `resources[]` memory-attach concept the
      // API renders into the system prompt; self-hosted has no resource attach.
      condition: forOperations(SESSION_STARTING_OPERATIONS, {
        field: 'memoryStoreId',
        value: '',
        not: true,
        and: { field: 'environmentType', value: 'cloud' },
      }),
      description: 'Per-attachment guidance rendered into the memory section of the system prompt.',
    },
    {
      id: 'files',
      title: 'Files',
      type: 'table',
      required: false,
      mode: 'advanced',
      // Cloud only: files attach as `resources[]`, which self-hosted rejects.
      condition: forOperations(SESSION_STARTING_OPERATIONS, {
        field: 'environmentType',
        value: 'cloud',
      }),
      columns: ['File ID', 'Mount path'],
      description:
        'Files-API file ids (file_...) to attach as file resources. Mount path is optional.',
    },
    {
      id: 'sessionParameters',
      title: 'Metadata',
      type: 'table',
      required: false,
      mode: 'advanced',
      columns: ['Key', 'Value'],
      condition: forOperations([...SESSION_STARTING_OPERATIONS, 'update_session']),
      description:
        'Optional key/value metadata forwarded on the session. On Update Session this REPLACES the stored metadata. On self-hosted environments each key is exposed to the agent as an env var.',
    },
  ],
  tools: {
    // Spelled out literally, not derived from OPERATION_TOOL_IDS: the docs
    // generator regex-matches this array, and a computed value makes it read as
    // empty and silently drops the whole Actions section from the docs page.
    // `managed_agent.test.ts` asserts the two never drift apart.
    access: [
      'managed_agent_run_session',
      'managed_agent_create_session',
      'managed_agent_send_message',
      'managed_agent_get_session',
      'managed_agent_list_events',
      'managed_agent_update_session',
      'managed_agent_interrupt_session',
      'managed_agent_respond_tool_confirmation',
      'managed_agent_respond_custom_tool',
      'managed_agent_archive_session',
      'managed_agent_delete_session',
    ],
    config: {
      // A block saved before the operation selector existed has no stored
      // `operation`, so it must keep resolving to the original run-session
      // behavior. The serializer applies the sub-block default, and this
      // fallback covers any path that bypasses it.
      tool: (params) =>
        OPERATION_TOOL_IDS[params.operation as ManagedAgentOperation] ??
        OPERATION_TOOL_IDS[DEFAULT_OPERATION],
    },
  },
  inputs: {
    credential: { type: 'string', description: 'Claude Platform credential id.' },
    operation: {
      type: 'string',
      description: 'Which session operation to run. Defaults to run_session.',
    },
    sessionId: {
      type: 'string',
      description: 'Session id (sesn_...) for operations that act on an existing session.',
    },
    eventTypes: {
      type: 'string',
      description: 'Comma-separated event-type filter for List Events.',
    },
    limit: {
      type: 'number',
      description: 'Maximum events returned by List Events.',
    },
    toolUseIds: {
      type: 'string',
      description: 'Comma-separated blocking tool-use event ids to confirm or deny.',
    },
    decision: {
      type: 'string',
      description: "Tool confirmation decision — 'allow' or 'deny'.",
    },
    denyMessage: {
      type: 'string',
      description: 'Reason surfaced to the agent when denying a tool call.',
    },
    title: { type: 'string', description: 'New session title for Update Session.' },
    clearMetadata: {
      type: 'boolean',
      description: "Removes all of the session's stored metadata on Update Session.",
    },
    customToolUseId: {
      type: 'string',
      description: 'The custom tool-use event id to answer.',
    },
    result: { type: 'string', description: "A custom tool's output, returned to the agent." },
    isError: { type: 'boolean', description: 'Marks a custom tool result as a failure.' },
    environmentType: {
      type: 'string',
      description:
        "Environment execution model — 'cloud' or 'self_hosted'. Filters the environment picker and gates cloud-only fields; the actual type is re-resolved server-side for routing.",
    },
    agent: { type: 'string', description: 'Managed-agent id inside the linked Claude workspace.' },
    environment: {
      type: 'string',
      description: 'Environment id inside the linked Claude workspace.',
    },
    userMessage: { type: 'string', description: 'The user message to send to the agent.' },
    vaults: { type: 'json', description: 'Vault ids for MCP auth (array of strings).' },
    vaultsAck: {
      type: 'boolean',
      description: 'Acknowledgement that the author may use the attached vaults.',
    },
    memoryStoreId: { type: 'string', description: 'Optional Agent Memory Store id.' },
    memoryAccess: {
      type: 'string',
      description: "Memory store access mode — 'read_write' (default) or 'read_only'.",
    },
    memoryInstructions: {
      type: 'string',
      description: 'Per-attachment guidance for how the agent should use the memory store.',
    },
    files: { type: 'json', description: 'File attachments — [{fileId, mountPath?}].' },
    sessionParameters: { type: 'json', description: 'Session metadata (key/value).' },
  },
  // Outputs are normally derived from the selected operation's tool. These are
  // the fallback and remain the Run Session shape, so existing references to
  // `content` / `sessionId` on already-saved blocks keep resolving.
  outputs: {
    content: { type: 'string', description: "The Managed Agent's final assistant text." },
    sessionId: { type: 'string', description: 'Anthropic session id, for logs and linking.' },
    inputTokens: { type: 'number', description: 'Cumulative input tokens for the session.' },
    outputTokens: { type: 'number', description: 'Cumulative output tokens for the session.' },
  },
}

export const ManagedAgentBlockMeta = {
  tags: ['agentic', 'llm'],
  url: 'https://platform.claude.com/',
  templates: [
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents overnight refactor',
      prompt:
        'Build a workflow that runs nightly, opens a Claude Managed Agents session against a mounted repository, asks it to work through the migration backlog, and posts the branches it pushed to Slack in the morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['slack'],
      featured: true,
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents PR reviewer',
      prompt:
        'Create a workflow that triggers on a new GitHub pull request, runs a Claude Managed Agents session over the diff, and posts the findings back as a review comment on the PR.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'code-review'],
      alsoIntegrations: ['github'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents approval gate',
      prompt:
        'Build a workflow that creates a Claude Managed Agents session, polls it for tool calls waiting on permission, posts each one to Slack for a human decision, and sends the allow or deny answer back to the session so it keeps working.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['human-in-the-loop', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents research desk',
      prompt:
        'Create a workflow that takes a research question, runs a Claude Managed Agents session to gather and cross-check sources, and writes the findings plus every citation into a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'automation'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents weekly report',
      prompt:
        'Build a scheduled workflow that runs a Claude Managed Agents session every Monday to compile last week’s metrics into a spreadsheet, then sends the finished file to the leadership list over Gmail.',
      modules: ['scheduled', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents support triage',
      prompt:
        'Create a workflow that opens a Claude Managed Agents session per incoming ticket, has it reproduce the issue and draft a reply, and files a Linear issue when it finds a real bug.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents conversational assistant',
      prompt:
        'Build a workflow that creates a Claude Managed Agents session on the first Slack message in a thread, stores the session id, and sends every later reply in that thread to the same session so the agent keeps its context across runs.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['messaging', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents run auditor',
      prompt:
        'Create a workflow that reads the event history of a finished Claude Managed Agents session, extracts every tool call and its result, and writes a per-run audit row into a table for compliance review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['compliance', 'monitoring'],
    },
    {
      icon: ClaudeIcon,
      title: 'Claude Managed Agents runaway stopper',
      prompt:
        'Build a scheduled workflow that checks long-running Claude Managed Agents sessions, interrupts any that have been working past a threshold, archives the ones that already finished, and posts what it stopped to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'run-managed-agent-task',
      description:
        'Send one task to a Claude Platform Managed Agent and wait for its final answer. Use for a self-contained job where you only need the result, not the intermediate steps.',
      content:
        '# Run Managed Agent Task\n\nHand a Claude Platform Managed Agent a single task and return what it produced.\n\n## Steps\n1. Choose the **Run session** operation — it creates a session, sends one message, waits for the agent to finish, and returns its text in one block.\n2. Select the Claude Platform account, then pick the Agent and Environment from that workspace. The agent already carries its own model, system prompt, and tools — you supply the task, not the configuration.\n3. Write the User message as a complete brief: the goal, the constraints, and what "done" looks like. The agent cannot ask a follow-up question mid-run, so anything you leave out it has to guess.\n4. Attach what the task needs: credential vaults for any MCP servers the agent calls, files it should read, and a memory store if it should carry context from earlier sessions.\n\n## Output\nReturn the agent\'s final text, plus the session id so the run can be traced later. Report the outcome as the agent stated it — if it says a step failed or was skipped, pass that through rather than summarizing it as success.',
    },
    {
      name: 'resume-managed-agent-conversation',
      description:
        'Keep one Managed Agent session alive across separate workflow runs so follow-up turns retain earlier context. Use for chat threads, ticket conversations, and any multi-turn exchange.',
      content:
        "# Resume Managed Agent Conversation\n\nHold a conversation with a Managed Agent across runs instead of starting over each time.\n\n## Steps\n1. On the first turn, use **Create session** — it opens the session and returns its id without waiting for a reply. Store that id somewhere durable (a table row keyed by the thread or ticket).\n2. On every later turn, use **Send message** with the stored Session ID. The agent still has its earlier turns; do not re-send the history.\n3. Use **Get session** when you need to know whether the agent is still working, is waiting on you, or has finished before you send the next message.\n4. When the conversation ends, use **Archive session** to make it read-only, or **Delete session** to remove it and its history entirely.\n\n## Output\nReturn the agent's reply for this turn and the session id you used. If the session turned out to be already terminated or archived, say so plainly rather than silently opening a new one — a fresh session loses every earlier turn.",
    },
    {
      name: 'approve-managed-agent-tool-calls',
      description:
        'Answer the permission prompts a Managed Agent raises before running a gated tool. Use when the agent is configured to ask before acting and a human or policy decides each call.',
      content:
        '# Approve Managed Agent Tool Calls\n\nUnblock a session that has paused waiting for permission to run a tool.\n\n## Steps\n1. Use **Get session** to see the session status and the tool calls currently waiting on a decision. A session sitting idle with pending calls is blocked until you answer.\n2. For each pending call, decide allow or deny. Route it to a person when the action is hard to reverse — sending mail, deleting data, pushing to a shared branch.\n3. Use **Respond to tool confirmation** with the tool use event IDs and the decision. Answer every pending call; one left unanswered keeps the session blocked.\n4. On a deny, write a Deny reason saying what to do instead. The agent reads it and adjusts, rather than retrying the same call.\n\n## Output\nReturn which calls were allowed and which were denied, with the reason for each denial, and confirm the session resumed. If it did not resume, report which calls are still pending instead of assuming the answers landed.',
    },
    {
      name: 'answer-managed-agent-custom-tool',
      description:
        'Execute a custom tool a Managed Agent invoked and return the result to the session. Use when the agent calls a tool your own workflow implements rather than one the platform runs.',
      content:
        "# Answer Managed Agent Custom Tool\n\nRun a tool the agent asked for and hand back what it produced.\n\n## Steps\n1. Use **Get session** or **List events** to find the custom tool call the agent is waiting on, and read the arguments it passed.\n2. Do the work in your workflow — call the API, query the table, run the function. This is the point of a custom tool: the credential and the logic stay on your side, never inside the agent's sandbox.\n3. Use **Respond to custom tool** with the custom tool use event ID and the result. Keep the result focused — the agent reads it directly, so return the fields it needs rather than a raw dump.\n4. If the work failed, still respond, and mark it as an error with the reason. The agent can then try a different approach instead of waiting on a result that will never come.\n\n## Output\nReturn what the tool did and what you sent back, and confirm the session resumed. Never fabricate a result to unblock a session — an invented answer propagates into everything the agent does next.",
    },
    {
      name: 'audit-managed-agent-session',
      description:
        'Reconstruct what a Managed Agent actually did from its event history. Use for compliance review, debugging a bad run, or reporting cost and token usage per run.',
      content:
        '# Audit Managed Agent Session\n\nBuild an evidence trail for one session from the events it emitted.\n\n## Steps\n1. Use **Get session** for the summary: status, title, metadata, and cumulative input and output tokens.\n2. Use **List events** to read the history. Narrow with Event types when you only care about one kind — tool calls, messages, status changes — and raise Max events when the run was long enough that the default page truncates it.\n3. Walk the events in order and pair each tool call with its result, so the record shows what the agent attempted and what came back, not just what it said afterwards.\n4. Write the reconstructed trail wherever it needs to live — a table row per run, a file, a message to the reviewing channel.\n\n## Output\nReturn the ordered list of what the agent did, the token totals, and the final status. Base every claim on an event you actually read; if the history was truncated, say where it stops rather than describing the run as complete.',
    },
    {
      name: 'stop-runaway-managed-agent-session',
      description:
        'Halt a Managed Agent session that is working longer than it should and clean it up. Use for cost control and for cancelling work a user changed their mind about.',
      content:
        '# Stop Runaway Managed Agent Session\n\nStop work in progress without losing what the session already produced.\n\n## Steps\n1. Use **Get session** to confirm the session is genuinely running rather than idle and waiting on you — a session blocked on a tool confirmation needs an answer, not an interrupt.\n2. Use **Interrupt session** to stop it. The agent halts at a safe point and goes idle; it does not treat the interrupt as a message, so its history and outputs survive.\n3. Send a follow-up message if you want it to continue differently. The session is still usable after an interrupt.\n4. When you are finished with it, use **Archive session** to keep the record read-only, or **Delete session** to remove the session and its history for good. Deletion is not reversible.\n\n## Output\nReturn why the session was stopped, what it had completed at that point, and whether you archived or deleted it. Prefer archive over delete when anyone may need the history later.',
    },
    {
      name: 'give-managed-agent-persistent-memory',
      description:
        'Attach a memory store so an agent carries learnings between sessions. Use when repeated runs should build on earlier ones instead of starting cold.',
      content:
        "# Give Managed Agent Persistent Memory\n\nLet an agent remember across sessions rather than only within one.\n\n## Steps\n1. Set the Environment type to cloud — memory stores and file attachments are cloud-only, and a self-hosted environment rejects them.\n2. On **Run session** or **Create session**, select the Memory store the agent should mount. Choose read-only when the store is shared reference material the agent must not edit; choose read-write when it should record what it learns.\n3. Write Memory instructions saying what lives in the store and when to consult it. The agent reads that description to decide whether the store is relevant, so describe the contents, not the mechanics.\n4. Keep secrets out of the store. Memories are replayed verbatim into every later session that mounts it — put API keys and tokens in a credential vault instead.\n\n## Output\nReturn the agent's result and note whether it read from or wrote to the store. If the agent reports that expected context was missing, say so rather than assuming the store was mounted correctly.",
    },
  ],
} as const satisfies BlockMeta
