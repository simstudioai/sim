/**
 * PostHog product analytics event catalog.
 *
 * Type-only module — zero runtime overhead. All event names and property shapes
 * are defined here as a single source of truth for compile-time safety at every
 * capture call site.
 */

export interface PostHogEventMap {
  user_created: {
    auth_method: 'email' | 'oauth' | 'sso'
    provider?: string
  }

  landing_page_viewed: Record<string, never>

  landing_cta_clicked: {
    label: string
    section:
      | 'hero'
      | 'navbar'
      | 'footer_cta'
      | 'pricing'
      | 'features'
      | 'collaboration'
      | 'templates'
      | 'landing_preview'
      | 'integrations'
    destination: 'auth_modal' | 'demo_modal' | '/signup' | '/login' | '/workspace' | (string & {})
  }

  auth_modal_opened: {
    view: 'login' | 'signup'
    source:
      | 'hero'
      | 'navbar'
      | 'mobile_navbar'
      | 'footer_cta'
      | 'pricing'
      | 'features'
      | 'collaboration'
      | 'landing_preview'
      | 'integrations'
  }

  landing_demo_request_submitted: {
    company_size: string
  }

  landing_contact_submitted: {
    topic: string
  }

  landing_prompt_submitted: Record<string, never>

  login_page_viewed: Record<string, never>

  signup_page_viewed: Record<string, never>

  signup_failed: {
    error_code: string
  }

  subscription_created: {
    plan: string
    status: string
    reference_id: string
  }

  subscription_cancelled: {
    plan: string
    reference_id: string
  }

  subscription_changed: {
    from_plan: string
    to_plan: string
    interval: string
  }

  workspace_created: {
    workspace_id: string
    name: string
    workspace_mode?: string
    organization_id?: string | null
  }

  workspace_member_invited: {
    workspace_id: string
    invitee_role: string
    membership_intent?: string
  }

  workspace_member_added: {
    workspace_id: string
    member_role: string
  }

  workspace_member_removed: {
    workspace_id: string
    is_self_removal: boolean
  }

  workspace_member_role_changed: {
    workspace_id: string
    new_role: string
  }

  workflow_created: {
    workflow_id: string
    workspace_id: string
    name: string
  }

  workflow_deployed: {
    workflow_id: string
    workspace_id: string
  }

  /** `block_types` is a comma-separated deduped list of block types that ran. */
  workflow_executed: {
    workflow_id: string
    workspace_id: string
    trigger_type: string
    success: boolean
    block_count: number
    block_types: string
    duration_ms: number
  }

  workflow_execution_failed: {
    workflow_id: string
    workspace_id: string
    trigger_type: string
    error_message: string
  }

  workflow_duplicated: {
    source_workflow_id: string
    new_workflow_id: string
    workspace_id: string
  }

  workflow_deleted: {
    workflow_id: string
    workspace_id: string
  }

  workflow_deployment_reverted: {
    workflow_id: string
    workspace_id: string
    version: string
  }

  workflow_execution_cancelled: {
    workflow_id: string
    workspace_id: string
  }

  workflow_undeployed: {
    workflow_id: string
    workspace_id: string
  }

  workflow_restored: {
    workflow_id: string
    workspace_id: string
  }

  workflow_public_api_toggled: {
    workflow_id: string
    workspace_id: string
    is_public: boolean
  }

  deployment_version_activated: {
    workflow_id: string
    workspace_id: string
    version: number
  }

  webhook_trigger_created: {
    webhook_id: string
    workflow_id: string
    workspace_id: string
    provider: string
  }

  webhook_trigger_deleted: {
    webhook_id: string
    workflow_id: string
    workspace_id: string
    provider: string
  }

  skill_created: {
    skill_id: string
    skill_name: string
    workspace_id: string
    source?: 'settings' | 'tool_input'
  }

  skill_updated: {
    skill_id: string
    skill_name: string
    workspace_id: string
    source?: 'settings' | 'tool_input'
  }

  skill_deleted: {
    skill_id: string
    workspace_id: string
    source?: 'settings' | 'tool_input'
  }

  workspace_deleted: {
    workspace_id: string
    workflow_count: number
  }

  notification_channel_deleted: {
    notification_id: string
    workspace_id: string
    notification_type: string
  }

  block_added: {
    block_type: string
    workflow_id: string
  }

  block_removed: {
    block_type: string
    workflow_id: string
  }

  knowledge_base_created: {
    knowledge_base_id: string
    workspace_id: string
    name: string
  }

  knowledge_base_document_uploaded: {
    knowledge_base_id: string
    workspace_id: string
    document_count: number
    upload_type: 'single' | 'bulk'
  }

  knowledge_base_connector_added: {
    knowledge_base_id: string
    workspace_id: string
    connector_type: string
    sync_interval_minutes: number
  }

  knowledge_base_connector_removed: {
    knowledge_base_id: string
    workspace_id: string
    connector_type: string
    documents_deleted: number
  }

  knowledge_base_connector_synced: {
    knowledge_base_id: string
    workspace_id: string
    connector_type: string
  }

  knowledge_base_opened: {
    knowledge_base_id: string
    knowledge_base_name: string
  }

  file_uploaded: {
    workspace_id: string
    file_type: string
  }

  file_deleted: {
    workspace_id: string
  }

  file_renamed: {
    workspace_id: string
  }

  file_moved: {
    workspace_id: string
    file_count: number
    folder_count: number
  }

  api_key_created: {
    workspace_id?: string
    key_name: string
    scope?: 'workspace' | 'personal'
    source?: 'settings' | 'deploy_modal'
  }

  api_key_revoked: {
    workspace_id?: string
    key_name: string
    scope?: 'workspace' | 'personal'
  }

  mcp_server_connected: {
    workspace_id: string
    server_name: string
    transport: string
    source?: 'settings' | 'tool_input'
  }

  mcp_server_disconnected: {
    workspace_id: string
    server_name: string
    source?: 'settings' | 'tool_input'
  }

  credential_connected: {
    credential_type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
    provider_id: string
    workspace_id: string
  }

  credential_deleted: {
    credential_type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
    provider_id: string
    workspace_id: string
  }

  credential_shared: {
    credential_type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
    role: 'admin' | 'member'
    workspace_id: string
  }

  credential_unshared: {
    credential_type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
    workspace_id: string
  }

  environment_updated: {
    workspace_id?: string
    key_count: number
    scope?: 'workspace' | 'personal'
  }

  environment_deleted: {
    workspace_id?: string
    key_count: number
    scope?: 'workspace' | 'personal'
  }

  seats_provisioned: {
    organization_id: string
    previous_seats: number
    seats: number
    reason: string
  }

  copilot_chat_sent: {
    workflow_id?: string
    workspace_id?: string
    has_file_attachments: boolean
    has_contexts: boolean
    mode: string
  }

  copilot_feedback_submitted: {
    is_positive: boolean
    has_text_feedback: boolean
    has_workflow_yaml: boolean
  }

  settings_tab_viewed: {
    plane: 'account' | 'organization' | 'workspace'
    section: string
  }

  table_opened: {
    table_id: string
    workspace_id: string
  }

  table_created: {
    table_id: string
    workspace_id: string
    column_count: number
  }

  table_deleted: {
    table_id: string
    workspace_id: string
  }

  /**
   * A table-workflow run was dispatched from the grid.
   * `source` distinguishes the gesture: a single row's gutter Play (`row`),
   * a multi-row selection across every workflow column (`rows`), or a single
   * workflow column header / column-scoped selection (`column`).
   */
  table_workflow_run: {
    table_id: string
    workspace_id: string
    source: 'row' | 'rows' | 'column'
    run_mode: 'all' | 'incomplete'
    group_count: number
    /** Number of explicitly targeted rows; `null` when the run targets all rows in scope. */
    row_count: number | null
    has_limit: boolean
    /** Which workflow version the run targets; omitted when groups mix modes. */
    deployment_mode?: 'live' | 'deployed' | 'mixed'
  }

  /**
   * Running table workflows were cancelled.
   * `scope` is `all` (every running row), `row` (one row's gutter Stop), or
   * `rows` (a multi-row selection).
   */
  table_workflow_stopped: {
    table_id: string
    workspace_id: string
    scope: 'all' | 'row' | 'rows'
    /** Number of rows targeted; `null` for the `all` scope. */
    row_count: number | null
  }

  table_import_started: {
    table_id: string
    workspace_id: string
    import_id: string
    file_type: 'csv' | 'tsv'
  }

  table_import_completed: {
    table_id: string
    workspace_id: string
    import_id: string
    status: 'completed' | 'failed'
    row_count: number | null
    error_message?: string
  }

  table_exported: {
    table_id: string
    workspace_id: string
  }

  file_downloaded: {
    workspace_id?: string
    is_bulk: boolean
    file_count: number
  }

  custom_tool_saved: {
    tool_id: string
    workspace_id: string
    tool_name: string
    source?: 'settings' | 'tool_input'
  }

  custom_tool_deleted: {
    tool_id: string
    workspace_id: string
    source?: 'settings' | 'tool_input'
  }

  byok_key_added: {
    workspace_id: string
    provider_id: string
  }

  byok_key_removed: {
    workspace_id: string
    provider_id: string
  }

  notification_channel_created: {
    workspace_id: string
    notification_type: 'webhook' | 'email' | 'slack'
    alert_rule: string | null
  }

  task_created: {
    workspace_id: string
  }

  task_renamed: {
    workspace_id: string
  }

  task_deleted: {
    workspace_id: string
  }

  task_forked: {
    workspace_id: string
    source_chat_id: string
  }

  task_marked_unread: {
    workspace_id: string
  }

  task_pinned: {
    workspace_id: string
  }

  task_unpinned: {
    workspace_id: string
  }

  task_generation_aborted: {
    workspace_id: string
    view: 'mothership' | 'copilot'
    request_id?: string
  }

  task_message_sent: {
    workspace_id: string
    has_attachments: boolean
    has_contexts: boolean
    is_new_task: boolean
  }

  /** Pairs with `task_message_sent` via `request_id` for correlation with server-side logs. */
  task_request_started: {
    workspace_id: string
    view: 'mothership' | 'copilot'
    request_id: string
    user_message_id: string
  }

  docs_opened: {
    source: 'help_menu' | 'editor_button' | 'toolbar_context_menu'
    block_type?: string
  }

  search_result_selected: {
    result_type:
      | 'block'
      | 'tool'
      | 'trigger'
      | 'tool_operation'
      | 'connected_account'
      | 'integration'
      | 'workflow'
      | 'workspace'
      | 'task'
      | 'table'
      | 'file'
      | 'knowledge_base'
      | 'page'
      | 'docs'
      | 'connected_account'
      | 'integration'
      | 'action'
    query_length: number
    workspace_id: string
    /** Present when `result_type` is `action`; the id of the action that ran. */
    action_id?: string
  }

  /** A home-page suggested action was clicked. `action_id` is the candidate id (e.g. `gmail-0`). */
  suggested_action_clicked: {
    workspace_id: string
    kind: 'prompt' | 'integration'
    action_id: string
    label: string
    position: number
    connected_provider_count: number
  }

  suggested_actions_shuffled: {
    workspace_id: string
    connected_provider_count: number
  }

  suggested_actions_toggled: {
    workspace_id: string
    expanded: boolean
  }

  /**
   * A curated "suggested skill" was added to the workspace from an integration's
   * detail page. `position` is the skill's index within the integration's list.
   */
  integration_skill_added: {
    workspace_id: string
    integration_type: string
    skill_name: string
    position: number
    skill_count: number
  }

  workflow_imported: {
    workspace_id: string
    workflow_count: number
    format: 'json' | 'zip'
  }

  workflow_exported: {
    workspace_id: string
    workflow_count: number
    format: 'json' | 'zip'
  }

  folder_created: {
    workspace_id: string
  }

  folder_deleted: {
    workspace_id: string
  }

  folder_renamed: {
    workspace_id: string
  }

  folder_moved: {
    workspace_id: string
    file_count: number
    folder_count: number
  }

  file_bulk_deleted: {
    workspace_id: string
    file_count: number
    folder_count: number
  }

  folder_restored: {
    folder_id: string
    workspace_id: string
  }

  logs_filter_applied: {
    filter_type: 'status' | 'workflow' | 'folder' | 'trigger' | 'time'
    workspace_id: string
  }

  knowledge_base_document_deleted: {
    knowledge_base_id: string
    workspace_id: string
  }

  scheduled_task_created: {
    workspace_id: string
  }

  scheduled_task_deleted: {
    workspace_id: string
  }

  workspace_logo_uploaded: {
    workspace_id: string
    file_name: string
    file_size: number
  }

  organization_created: {
    organization_id: string
    name?: string
  }

  /** Org membership lifecycle (distinct from workspace-level membership). */
  org_member_added: {
    organization_id: string
    member_role: string
  }

  org_member_removed: {
    organization_id: string
    is_self_removal: boolean
  }

  org_member_role_changed: {
    organization_id: string
    new_role: string
  }

  /** Org seat count decreased (member removal / drift reconciliation). */
  seats_deprovisioned: {
    organization_id: string
    previous_seats: number
    seats: number
    reason: string
  }

  /** A workflow's edit-lock was toggled on or off. */
  workflow_lock_toggled: {
    workflow_id: string
    workspace_id?: string
    locked: boolean
  }

  workflow_schedule_created: {
    workflow_id: string
    workspace_id: string
  }

  workflow_schedule_deleted: {
    workflow_id: string
    workspace_id: string
  }

  /** A stored credential's plaintext secret was deliberately retrieved via the token API. */
  credential_used: {
    credential_type: 'oauth' | 'env_workspace' | 'env_personal' | 'service_account'
    provider_id: string
    workspace_id?: string
  }

  payment_succeeded: {
    plan: string
    amount: number
    currency: string
    entity_type: 'user' | 'organization'
    reference_id: string
  }

  payment_failed: {
    plan: string
    amount: number
    currency: string
    entity_type: 'user' | 'organization'
    reference_id: string
    attempt_count: number
  }

  overage_billed: {
    amount: number
    currency: string
    entity_type: 'user' | 'organization'
    reference_id: string
    settled_via: 'stripe' | 'credits'
  }

  credits_purchased: {
    amount: number
    currency: string
    entity_type: 'user' | 'organization'
    reference_id: string
  }

  charge_disputed: {
    amount: number
    currency: string
    reason: string
    status: 'opened' | 'closed'
    entity_type: 'user' | 'organization'
    reference_id: string
  }

  plan_converted: {
    organization_id: string
    from_plan: string
    to_plan: string
  }

  enterprise_subscription_created: {
    reference_id: string
    seats: number
    monthly_price: number
    currency: string
  }

  subscription_transferred: {
    subscription_id: string
    from_entity: 'user' | 'organization'
    to_entity: 'user' | 'organization'
  }
}

export type PostHogEventName = keyof PostHogEventMap
