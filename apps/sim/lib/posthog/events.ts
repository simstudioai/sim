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
  }

  workspace_member_invited: {
    workspace_id: string
    invitee_role: string
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

  a2a_agent_deleted: {
    agent_id: string
    workflow_id: string
    workspace_id: string
  }

  a2a_agent_published: {
    agent_id: string
    workflow_id: string
    workspace_id: string
  }

  a2a_agent_unpublished: {
    agent_id: string
    workflow_id: string
    workspace_id: string
  }

  a2a_agent_created: {
    agent_id: string
    workflow_id: string
    workspace_id: string
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

  api_key_created: {
    workspace_id: string
    key_name: string
    source?: 'settings' | 'deploy_modal'
  }

  api_key_revoked: {
    workspace_id: string
    key_name: string
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

  copilot_chat_sent: {
    workflow_id: string
    workspace_id: string
    has_file_attachments: boolean
    has_contexts: boolean
    mode: string
  }

  copilot_feedback_submitted: {
    is_positive: boolean
    has_text_feedback: boolean
    has_workflow_yaml: boolean
  }

  /** `template_modules` is a space-separated list of module tags, e.g. `"agent tables knowledge-base"`. */
  template_used: {
    template_title: string
    template_modules: string
  }

  settings_tab_viewed: {
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

  task_marked_unread: {
    workspace_id: string
  }

  task_generation_aborted: {
    workspace_id: string
    view: 'mothership' | 'copilot'
  }

  task_message_sent: {
    workspace_id: string
    has_attachments: boolean
    has_contexts: boolean
    is_new_task: boolean
  }

  tour_started: {
    tour_type: 'nav' | 'workflow'
  }

  tour_completed: {
    tour_type: 'nav' | 'workflow'
  }

  tour_skipped: {
    tour_type: 'nav' | 'workflow'
    step_index: number
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
      | 'workflow'
      | 'workspace'
      | 'task'
      | 'table'
      | 'file'
      | 'knowledge_base'
      | 'page'
      | 'docs'
    query_length: number
    workspace_id: string
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
}

export type PostHogEventName = keyof PostHogEventMap
