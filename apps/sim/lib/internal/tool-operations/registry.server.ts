import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { isMcpTool } from '@/executor/constants'

type InternalToolOperationHandlerLoader = () => Promise<InternalToolOperationHandler>

const STS_TOOL_IDS = [
  'sts_assume_role',
  'sts_assume_role_with_web_identity',
  'sts_assume_role_with_saml',
  'sts_get_caller_identity',
  'sts_get_session_token',
  'sts_get_access_key_info',
] as const

const APPCONFIG_TOOL_IDS = [
  'appconfig_create_application',
  'appconfig_create_configuration_profile',
  'appconfig_create_environment',
  'appconfig_create_hosted_configuration_version',
  'appconfig_delete_application',
  'appconfig_delete_configuration_profile',
  'appconfig_delete_environment',
  'appconfig_delete_hosted_configuration_version',
  'appconfig_get_application',
  'appconfig_get_configuration',
  'appconfig_get_configuration_profile',
  'appconfig_get_deployment',
  'appconfig_get_environment',
  'appconfig_get_hosted_configuration_version',
  'appconfig_list_applications',
  'appconfig_list_configuration_profiles',
  'appconfig_list_deployment_strategies',
  'appconfig_list_deployments',
  'appconfig_list_environments',
  'appconfig_list_hosted_configuration_versions',
  'appconfig_start_deployment',
  'appconfig_stop_deployment',
  'appconfig_update_application',
  'appconfig_update_configuration_profile',
  'appconfig_update_environment',
] as const

const IAM_TOOL_IDS = [
  'iam_add_user_to_group',
  'iam_attach_role_policy',
  'iam_attach_user_policy',
  'iam_create_access_key',
  'iam_create_role',
  'iam_create_user',
  'iam_delete_access_key',
  'iam_delete_role',
  'iam_delete_user',
  'iam_detach_role_policy',
  'iam_detach_user_policy',
  'iam_get_policy',
  'iam_get_role',
  'iam_get_user',
  'iam_list_access_keys',
  'iam_list_attached_role_policies',
  'iam_list_attached_user_policies',
  'iam_list_groups',
  'iam_list_policies',
  'iam_list_roles',
  'iam_list_users',
  'iam_remove_user_from_group',
  'iam_simulate_principal_policy',
  'iam_update_access_key',
] as const

const IDENTITY_CENTER_TOOL_IDS = [
  'identity_center_list_instances',
  'identity_center_list_accounts',
  'identity_center_describe_account',
  'identity_center_list_permission_sets',
  'identity_center_get_user',
  'identity_center_get_group',
  'identity_center_list_groups',
  'identity_center_create_account_assignment',
  'identity_center_delete_account_assignment',
  'identity_center_check_assignment_status',
  'identity_center_check_assignment_deletion_status',
  'identity_center_list_account_assignments',
  'identity_center_list_assignments_for_account',
  'identity_center_describe_user',
  'identity_center_describe_group',
  'identity_center_list_group_memberships',
] as const

const SECRETS_MANAGER_TOOL_IDS = [
  'secrets_manager_get_secret',
  'secrets_manager_list_secrets',
  'secrets_manager_create_secret',
  'secrets_manager_update_secret',
  'secrets_manager_delete_secret',
  'secrets_manager_describe_secret',
  'secrets_manager_tag_resource',
  'secrets_manager_untag_resource',
  'secrets_manager_restore_secret',
  'secrets_manager_rotate_secret',
] as const

const SSM_TOOL_IDS = [
  'ssm_send_command',
  'ssm_list_commands',
  'ssm_list_command_invocations',
  'ssm_get_command_invocation',
  'ssm_cancel_command',
  'ssm_get_parameter',
  'ssm_get_parameters',
  'ssm_get_parameters_by_path',
  'ssm_put_parameter',
  'ssm_delete_parameter',
  'ssm_describe_parameters',
  'ssm_describe_instance_information',
  'ssm_describe_instance_patches',
  'ssm_describe_instance_patch_states',
  'ssm_list_compliance_items',
  'ssm_list_compliance_summaries',
  'ssm_start_automation_execution',
  'ssm_describe_automation_executions',
  'ssm_get_automation_execution',
  'ssm_stop_automation_execution',
  'ssm_list_documents',
  'ssm_get_document',
] as const

const DYNAMODB_TOOL_IDS = [
  'dynamodb_delete',
  'dynamodb_get',
  'dynamodb_introspect',
  'dynamodb_put',
  'dynamodb_query',
  'dynamodb_scan',
  'dynamodb_update',
] as const

const SES_TOOL_IDS = [
  'ses_create_configuration_set',
  'ses_create_email_identity',
  'ses_create_template',
  'ses_delete_email_identity',
  'ses_delete_suppressed_destination',
  'ses_delete_template',
  'ses_get_account',
  'ses_get_email_identity',
  'ses_get_suppressed_destination',
  'ses_get_template',
  'ses_list_identities',
  'ses_list_suppressed_destinations',
  'ses_list_templates',
  'ses_put_suppressed_destination',
  'ses_send_bulk_email',
  'ses_send_custom_verification_email',
  'ses_send_email',
  'ses_send_templated_email',
  'ses_update_template',
] as const

const SQS_TOOL_IDS = [
  'sqs_send',
  'sqs_send_message_batch',
  'sqs_receive_message',
  'sqs_delete_message',
  'sqs_delete_message_batch',
  'sqs_change_message_visibility',
  'sqs_change_message_visibility_batch',
  'sqs_list_queues',
  'sqs_get_queue_url',
  'sqs_get_queue_attributes',
  'sqs_set_queue_attributes',
  'sqs_create_queue',
  'sqs_delete_queue',
  'sqs_purge_queue',
  'sqs_list_dead_letter_source_queues',
  'sqs_list_queue_tags',
  'sqs_tag_queue',
  'sqs_untag_queue',
  'sqs_start_message_move_task',
  'sqs_list_message_move_tasks',
  'sqs_cancel_message_move_task',
] as const

const RDS_TOOL_IDS = [
  'rds_query',
  'rds_execute',
  'rds_insert',
  'rds_update',
  'rds_delete',
  'rds_introspect',
] as const

const TEXTRACT_TOOL_IDS = [
  'textract_parser',
  'textract_parser_v2',
  'textract_analyze_expense',
  'textract_analyze_id',
] as const

const CLOUDTRAIL_TOOL_IDS = [
  'cloudtrail_cancel_query',
  'cloudtrail_describe_query',
  'cloudtrail_describe_trails',
  'cloudtrail_get_event_data_store',
  'cloudtrail_get_event_selectors',
  'cloudtrail_get_insight_selectors',
  'cloudtrail_get_query_results',
  'cloudtrail_get_trail',
  'cloudtrail_get_trail_status',
  'cloudtrail_list_event_data_stores',
  'cloudtrail_list_tags',
  'cloudtrail_list_trails',
  'cloudtrail_lookup_events',
  'cloudtrail_start_query',
] as const

const CLOUDWATCH_TOOL_IDS = [
  'cloudwatch_describe_alarm_history',
  'cloudwatch_describe_alarms',
  'cloudwatch_describe_log_groups',
  'cloudwatch_describe_log_streams',
  'cloudwatch_filter_log_events',
  'cloudwatch_get_log_events',
  'cloudwatch_get_metric_statistics',
  'cloudwatch_list_metrics',
  'cloudwatch_mute_alarm',
  'cloudwatch_put_log_group_retention',
  'cloudwatch_put_metric_data',
  'cloudwatch_query_logs',
  'cloudwatch_unmute_alarm',
] as const

const POSTGRESQL_TOOL_IDS = [
  'postgresql_query',
  'postgresql_execute',
  'postgresql_insert',
  'postgresql_update',
  'postgresql_delete',
  'postgresql_introspect',
] as const

const REDIS_TOOL_IDS = [
  'redis_command',
  'redis_delete',
  'redis_exists',
  'redis_expire',
  'redis_get',
  'redis_hdel',
  'redis_hget',
  'redis_hgetall',
  'redis_hset',
  'redis_incr',
  'redis_incrby',
  'redis_keys',
  'redis_llen',
  'redis_lpop',
  'redis_lpush',
  'redis_lrange',
  'redis_persist',
  'redis_rpop',
  'redis_rpush',
  'redis_set',
  'redis_setnx',
  'redis_ttl',
] as const

const CLOUDFORMATION_TOOL_IDS = [
  'cloudformation_cancel_update_stack',
  'cloudformation_create_change_set',
  'cloudformation_create_stack',
  'cloudformation_delete_stack',
  'cloudformation_describe_change_set',
  'cloudformation_describe_stack_drift_detection_status',
  'cloudformation_describe_stack_events',
  'cloudformation_describe_stacks',
  'cloudformation_detect_stack_drift',
  'cloudformation_execute_change_set',
  'cloudformation_get_template',
  'cloudformation_get_template_summary',
  'cloudformation_list_stack_resources',
  'cloudformation_update_stack',
  'cloudformation_validate_template',
] as const

const LAMBDA_TOOL_IDS = [
  'lambda_add_permission',
  'lambda_create_alias',
  'lambda_create_event_source_mapping',
  'lambda_create_function',
  'lambda_create_function_url_config',
  'lambda_delete_alias',
  'lambda_delete_event_source_mapping',
  'lambda_delete_function',
  'lambda_delete_function_concurrency',
  'lambda_delete_function_event_invoke_config',
  'lambda_delete_function_url_config',
  'lambda_delete_provisioned_concurrency_config',
  'lambda_get_account_settings',
  'lambda_get_alias',
  'lambda_get_event_source_mapping',
  'lambda_get_function',
  'lambda_get_function_concurrency',
  'lambda_get_function_configuration',
  'lambda_get_function_event_invoke_config',
  'lambda_get_function_recursion_config',
  'lambda_get_function_url_config',
  'lambda_get_layer_version',
  'lambda_get_policy',
  'lambda_get_provisioned_concurrency_config',
  'lambda_get_runtime_management_config',
  'lambda_invoke',
  'lambda_list_aliases',
  'lambda_list_event_source_mappings',
  'lambda_list_function_event_invoke_configs',
  'lambda_list_function_url_configs',
  'lambda_list_functions',
  'lambda_list_layer_versions',
  'lambda_list_layers',
  'lambda_list_provisioned_concurrency_configs',
  'lambda_list_tags',
  'lambda_list_versions_by_function',
  'lambda_publish_version',
  'lambda_put_function_concurrency',
  'lambda_put_function_event_invoke_config',
  'lambda_put_function_recursion_config',
  'lambda_put_provisioned_concurrency_config',
  'lambda_put_runtime_management_config',
  'lambda_remove_permission',
  'lambda_tag_resource',
  'lambda_untag_resource',
  'lambda_update_alias',
  'lambda_update_event_source_mapping',
  'lambda_update_function_code',
  'lambda_update_function_configuration',
  'lambda_update_function_url_config',
] as const

const CODEPIPELINE_TOOL_IDS = [
  'codepipeline_disable_stage_transition',
  'codepipeline_enable_stage_transition',
  'codepipeline_get_pipeline',
  'codepipeline_get_pipeline_execution',
  'codepipeline_get_pipeline_state',
  'codepipeline_list_action_executions',
  'codepipeline_list_pipeline_executions',
  'codepipeline_list_pipelines',
  'codepipeline_put_approval_result',
  'codepipeline_retry_stage_execution',
  'codepipeline_start_execution',
  'codepipeline_stop_execution',
] as const

const MYSQL_TOOL_IDS = [
  'mysql_query',
  'mysql_execute',
  'mysql_insert',
  'mysql_update',
  'mysql_delete',
  'mysql_introspect',
] as const

const ATHENA_TOOL_IDS = [
  'athena_batch_get_named_query',
  'athena_batch_get_prepared_statement',
  'athena_batch_get_query_execution',
  'athena_create_named_query',
  'athena_create_prepared_statement',
  'athena_delete_named_query',
  'athena_delete_prepared_statement',
  'athena_get_data_catalog',
  'athena_get_database',
  'athena_get_named_query',
  'athena_get_prepared_statement',
  'athena_get_query_execution',
  'athena_get_query_results',
  'athena_get_query_runtime_statistics',
  'athena_get_table_metadata',
  'athena_get_work_group',
  'athena_list_data_catalogs',
  'athena_list_databases',
  'athena_list_named_queries',
  'athena_list_prepared_statements',
  'athena_list_query_executions',
  'athena_list_table_metadata',
  'athena_list_work_groups',
  'athena_start_query',
  'athena_stop_query',
  'athena_update_named_query',
  'athena_update_prepared_statement',
] as const

const CLICKHOUSE_TOOL_IDS = [
  'clickhouse_count_rows',
  'clickhouse_create_database',
  'clickhouse_create_table',
  'clickhouse_delete',
  'clickhouse_describe_table',
  'clickhouse_drop_database',
  'clickhouse_drop_partition',
  'clickhouse_drop_table',
  'clickhouse_execute',
  'clickhouse_insert_rows',
  'clickhouse_insert',
  'clickhouse_introspect',
  'clickhouse_kill_query',
  'clickhouse_list_clusters',
  'clickhouse_list_databases',
  'clickhouse_list_mutations',
  'clickhouse_list_partitions',
  'clickhouse_list_running_queries',
  'clickhouse_list_tables',
  'clickhouse_optimize_table',
  'clickhouse_query',
  'clickhouse_rename_table',
  'clickhouse_show_create_table',
  'clickhouse_table_stats',
  'clickhouse_truncate_table',
  'clickhouse_update',
] as const

const MONGODB_TOOL_IDS = [
  'mongodb_query',
  'mongodb_execute',
  'mongodb_insert',
  'mongodb_update',
  'mongodb_delete',
  'mongodb_introspect',
] as const

const NEO4J_TOOL_IDS = [
  'neo4j_query',
  'neo4j_execute',
  'neo4j_create',
  'neo4j_update',
  'neo4j_delete',
  'neo4j_merge',
  'neo4j_introspect',
] as const

const S3_TOOL_IDS = [
  's3_copy_object',
  's3_create_bucket',
  's3_delete_bucket',
  's3_delete_object',
  's3_delete_objects',
  's3_head_object',
  's3_list_buckets',
  's3_list_objects',
  's3_presigned_url',
  's3_put_object',
] as const

const JUPYTER_TOOL_IDS = [
  'jupyter_copy_content',
  'jupyter_create_file',
  'jupyter_create_session',
  'jupyter_delete_content',
  'jupyter_delete_session',
  'jupyter_get_content',
  'jupyter_interrupt_kernel',
  'jupyter_list_contents',
  'jupyter_list_kernels',
  'jupyter_list_kernelspecs',
  'jupyter_list_sessions',
  'jupyter_rename_content',
  'jupyter_restart_kernel',
  'jupyter_start_kernel',
  'jupyter_stop_kernel',
  'jupyter_upload_file',
] as const

const MSSQL_TOOL_IDS = [
  'mssql_query',
  'mssql_execute',
  'mssql_insert',
  'mssql_update',
  'mssql_delete',
  'mssql_introspect',
] as const

const KNOWLEDGE_TOOL_IDS = [
  'knowledge_create_document',
  'knowledge_delete_chunk',
  'knowledge_delete_document',
  'knowledge_get_connector',
  'knowledge_get_document',
  'knowledge_list_chunks',
  'knowledge_list_connectors',
  'knowledge_list_documents',
  'knowledge_list_tags',
  'knowledge_search',
  'knowledge_trigger_sync',
  'knowledge_update_chunk',
  'knowledge_upload_chunk',
  'knowledge_upsert_document',
] as const

const CONFLUENCE_TOOL_IDS = [
  'confluence_add_label',
  'confluence_create_blogpost',
  'confluence_create_comment',
  'confluence_create_page',
  'confluence_create_page_property',
  'confluence_create_space',
  'confluence_create_space_property',
  'confluence_delete_attachment',
  'confluence_delete_blogpost',
  'confluence_delete_comment',
  'confluence_delete_label',
  'confluence_delete_page',
  'confluence_delete_page_property',
  'confluence_delete_space',
  'confluence_delete_space_property',
  'confluence_get_blogpost',
  'confluence_get_page_ancestors',
  'confluence_get_page_children',
  'confluence_get_page_descendants',
  'confluence_get_page_version',
  'confluence_get_pages_by_label',
  'confluence_get_space',
  'confluence_get_task',
  'confluence_get_user',
  'confluence_list_attachments',
  'confluence_list_blogposts',
  'confluence_list_blogposts_in_space',
  'confluence_list_comments',
  'confluence_list_labels',
  'confluence_list_page_properties',
  'confluence_list_page_versions',
  'confluence_list_pages_in_space',
  'confluence_list_space_labels',
  'confluence_list_space_permissions',
  'confluence_list_space_properties',
  'confluence_list_spaces',
  'confluence_list_tasks',
  'confluence_retrieve',
  'confluence_search',
  'confluence_search_in_space',
  'confluence_update',
  'confluence_update_blogpost',
  'confluence_update_comment',
  'confluence_update_space',
  'confluence_update_task',
  'confluence_upload_attachment',
] as const

const JSM_TOOL_IDS = [
  'jsm_add_comment',
  'jsm_add_customer',
  'jsm_add_organization',
  'jsm_add_participants',
  'jsm_answer_approval',
  'jsm_attach_form',
  'jsm_copy_forms',
  'jsm_create_object',
  'jsm_create_organization',
  'jsm_create_request',
  'jsm_delete_form',
  'jsm_delete_object',
  'jsm_externalise_form',
  'jsm_get_approvals',
  'jsm_get_comments',
  'jsm_get_customers',
  'jsm_get_form',
  'jsm_get_form_answers',
  'jsm_get_form_structure',
  'jsm_get_form_templates',
  'jsm_get_issue_forms',
  'jsm_get_object',
  'jsm_get_object_schema',
  'jsm_get_object_type_attributes',
  'jsm_get_organizations',
  'jsm_get_participants',
  'jsm_get_queues',
  'jsm_get_request',
  'jsm_get_requests',
  'jsm_get_request_type_fields',
  'jsm_get_request_types',
  'jsm_get_service_desks',
  'jsm_get_sla',
  'jsm_get_transitions',
  'jsm_internalise_form',
  'jsm_list_object_schemas',
  'jsm_list_object_types',
  'jsm_reopen_form',
  'jsm_save_form_answers',
  'jsm_search_objects_aql',
  'jsm_submit_form',
  'jsm_transition_request',
  'jsm_update_object',
] as const

const CROWDSTRIKE_TOOL_IDS = [
  'crowdstrike_create_indicators',
  'crowdstrike_delete_indicators',
  'crowdstrike_delete_rtr_session',
  'crowdstrike_execute_rtr_command',
  'crowdstrike_get_alert_details',
  'crowdstrike_get_case_details',
  'crowdstrike_get_host_group_details',
  'crowdstrike_get_indicator_details',
  'crowdstrike_get_rtr_command_status',
  'crowdstrike_get_sensor_aggregates',
  'crowdstrike_get_sensor_details',
  'crowdstrike_get_vulnerability_details',
  'crowdstrike_init_rtr_session',
  'crowdstrike_perform_host_action',
  'crowdstrike_perform_host_group_action',
  'crowdstrike_query_alerts',
  'crowdstrike_query_cases',
  'crowdstrike_query_host_groups',
  'crowdstrike_query_indicators',
  'crowdstrike_query_sensors',
  'crowdstrike_query_vulnerabilities',
  'crowdstrike_update_alerts',
  'crowdstrike_update_indicators',
] as const

const GMAIL_TOOL_IDS = [
  'gmail_add_label',
  'gmail_add_label_v2',
  'gmail_archive',
  'gmail_archive_v2',
  'gmail_delete',
  'gmail_delete_v2',
  'gmail_draft',
  'gmail_draft_v2',
  'gmail_edit_draft_v2',
  'gmail_mark_read',
  'gmail_mark_read_v2',
  'gmail_mark_unread',
  'gmail_mark_unread_v2',
  'gmail_move',
  'gmail_move_v2',
  'gmail_remove_label',
  'gmail_remove_label_v2',
  'gmail_send',
  'gmail_send_v2',
  'gmail_unarchive',
  'gmail_unarchive_v2',
] as const

const WINDCHILL_TOOL_IDS = [
  'windchill_create_document',
  'windchill_create_documents',
  'windchill_update_document',
  'windchill_update_common_properties',
  'windchill_update_documents',
  'windchill_delete_document',
  'windchill_delete_documents',
  'windchill_check_out_document',
  'windchill_check_out_documents',
  'windchill_check_in_document',
  'windchill_check_in_documents',
  'windchill_undo_check_out_document',
  'windchill_undo_check_out_documents',
  'windchill_revise_document',
  'windchill_revise_documents',
  'windchill_set_lifecycle_state',
  'windchill_update_document_security_labels',
  'windchill_download_primary_content',
  'windchill_upload_primary_content',
  'windchill_download_attachment',
  'windchill_upload_attachments',
] as const

const TABLE_TOOL_IDS = [
  'table_create',
  'table_list',
  'table_get_schema',
  'table_get_row',
  'table_insert_row',
  'table_batch_insert_rows',
  'table_query_rows',
  'table_query_rows_v2',
  'table_update_row',
  'table_update_rows_by_filter',
  'table_delete_row',
  'table_delete_rows_by_filter',
  'table_upsert_row',
] as const

const WORKDAY_TOOL_IDS = [
  'workday_assign_onboarding',
  'workday_change_job',
  'workday_create_prehire',
  'workday_get_compensation',
  'workday_get_organizations',
  'workday_get_worker',
  'workday_hire_employee',
  'workday_list_workers',
  'workday_terminate_worker',
  'workday_update_worker',
] as const

const AGILOFT_TOOL_IDS = [
  'agiloft_async_status',
  'agiloft_attach_file',
  'agiloft_attachment_info',
  'agiloft_create_record',
  'agiloft_delete_record',
  'agiloft_get_choice_line_id',
  'agiloft_list_tables',
  'agiloft_lock_record',
  'agiloft_nlp_search',
  'agiloft_read_record',
  'agiloft_remove_attachment',
  'agiloft_retrieve_attachment',
  'agiloft_run_action_button',
  'agiloft_saved_search',
  'agiloft_search_records',
  'agiloft_select_records',
  'agiloft_update_record',
  'agiloft_upsert_record',
] as const

const ONEPASSWORD_TOOL_IDS = [
  'onepassword_create_item',
  'onepassword_delete_item',
  'onepassword_get_item',
  'onepassword_get_item_file',
  'onepassword_get_vault',
  'onepassword_list_items',
  'onepassword_list_vaults',
  'onepassword_replace_item',
  'onepassword_resolve_secret',
  'onepassword_update_item',
] as const

const OUTLOOK_TOOL_IDS = [
  'outlook_copy',
  'outlook_delete',
  'outlook_draft',
  'outlook_mark_read',
  'outlook_mark_unread',
  'outlook_move',
  'outlook_send',
] as const

const SSH_TOOL_IDS = [
  'ssh_check_command_exists',
  'ssh_check_file_exists',
  'ssh_create_directory',
  'ssh_delete_file',
  'ssh_download_file',
  'ssh_execute_command',
  'ssh_execute_script',
  'ssh_get_system_info',
  'ssh_list_directory',
  'ssh_move_rename',
  'ssh_read_file_content',
  'ssh_upload_file',
  'ssh_write_file_content',
] as const

const ASANA_TOOL_IDS = [
  'asana_add_comment',
  'asana_add_followers',
  'asana_create_project',
  'asana_create_section',
  'asana_create_subtask',
  'asana_create_task',
  'asana_delete_task',
  'asana_get_project',
  'asana_get_projects',
  'asana_get_task',
  'asana_list_sections',
  'asana_list_workspaces',
  'asana_search_tasks',
  'asana_update_task',
] as const

const DOCUSIGN_TOOL_IDS = [
  'docusign_create_from_template',
  'docusign_download_document',
  'docusign_get_envelope',
  'docusign_list_envelopes',
  'docusign_list_recipients',
  'docusign_list_templates',
  'docusign_send_envelope',
  'docusign_void_envelope',
] as const

const QUICKBOOKS_TOOL_IDS = [
  'quickbooks_add_attachment',
  'quickbooks_create_bill_payment',
  'quickbooks_download_attachment',
  'quickbooks_download_transaction_pdf',
  'quickbooks_update_bill',
  'quickbooks_update_bill_payment',
  'quickbooks_update_credit_memo',
  'quickbooks_update_customer_payment',
  'quickbooks_update_employee',
  'quickbooks_update_item',
  'quickbooks_update_purchase',
  'quickbooks_update_purchase_order',
  'quickbooks_update_refund_receipt',
  'quickbooks_update_vendor',
  'quickbooks_update_vendor_credit',
] as const

const THINKING_TOOL_IDS = ['thinking_tool'] as const

const BITBUCKET_TOOL_IDS = [
  'bitbucket_get_file',
  'bitbucket_get_pipeline_step_log',
  'bitbucket_get_pull_request_diff',
  'bitbucket_get_pull_request_diffstat',
] as const

const BROWSER_USE_TOOL_IDS = ['browser_use_run_task'] as const

const CBINSIGHTS_TOOL_IDS = [
  'cbinsights_chat',
  'cbinsights_get_commercial_maturity_history',
  'cbinsights_get_exit_probability_history',
  'cbinsights_get_mosaic_history',
  'cbinsights_get_org_business_relationships',
  'cbinsights_get_org_funding_window',
  'cbinsights_get_org_fundings',
  'cbinsights_get_org_investments',
  'cbinsights_get_org_management_and_board',
  'cbinsights_get_org_outlook',
  'cbinsights_get_org_portfolio_exits',
  'cbinsights_get_org_revenue',
  'cbinsights_get_scouting_report',
  'cbinsights_get_strategy_map',
  'cbinsights_list_business_relationships',
  'cbinsights_list_funding_window',
  'cbinsights_list_fundings',
  'cbinsights_list_investments',
  'cbinsights_list_management_and_board',
  'cbinsights_list_outlook',
  'cbinsights_list_portfolio_exits',
  'cbinsights_list_revenue',
  'cbinsights_lookup_organizations',
  'cbinsights_rag',
  'cbinsights_search_firmographics',
] as const

const CLOUDFLARE_TOOL_IDS = ['cloudflare_get_zone_settings'] as const
const DATADOG_TOOL_IDS = ['datadog_update_slo'] as const

const MANAGED_AGENT_TOOL_IDS = [
  'managed_agent_archive_session',
  'managed_agent_create_session',
  'managed_agent_delete_session',
  'managed_agent_get_session',
  'managed_agent_interrupt_session',
  'managed_agent_list_events',
  'managed_agent_respond_custom_tool',
  'managed_agent_respond_tool_confirmation',
  'managed_agent_run_session',
  'managed_agent_send_message',
  'managed_agent_update_session',
] as const

const MICROSOFT_AD_TOOL_IDS = ['microsoft_ad_add_user_app_role_assignment'] as const

const NETSUITE_TOOL_IDS = [
  'netsuite_attach_record',
  'netsuite_batch_create_records',
  'netsuite_batch_delete_records',
  'netsuite_batch_get_records',
  'netsuite_batch_update_records',
  'netsuite_batch_upsert_records',
  'netsuite_create_record',
  'netsuite_delete_record',
  'netsuite_detach_record',
  'netsuite_execute_action',
  'netsuite_execute_dataset',
  'netsuite_execute_suiteql',
  'netsuite_get_async_result',
  'netsuite_get_async_status',
  'netsuite_get_governance_limits',
  'netsuite_get_record',
  'netsuite_get_record_form',
  'netsuite_get_record_metadata',
  'netsuite_get_select_options',
  'netsuite_get_server_time',
  'netsuite_get_subresource',
  'netsuite_list_datasets',
  'netsuite_list_record_types',
  'netsuite_list_records',
  'netsuite_transform_record',
  'netsuite_update_record',
  'netsuite_upsert_record',
] as const

const OKTA_TOOL_IDS = ['okta_update_group'] as const
const SALESFORCE_TOOL_IDS = ['salesforce_update_custom_field'] as const

const SLACK_TOOL_IDS = [
  'slack_add_reaction',
  'slack_delete_message',
  'slack_download',
  'slack_get_channel_history',
  'slack_get_thread_replies',
  'slack_list_channels',
  'slack_ephemeral_message',
  'slack_message',
  'slack_message_reader',
  'slack_remove_reaction',
  'slack_update_message',
] as const

const SEARCH_TOOL_IDS = ['search_tool'] as const

const SMS_TOOL_IDS = ['sms_send'] as const

const MICROSOFT_WORD_TOOL_IDS = [
  'microsoft_word_append',
  'microsoft_word_create',
  'microsoft_word_create_from_template',
  'microsoft_word_export_pdf',
  'microsoft_word_read',
  'microsoft_word_replace_text',
  'microsoft_word_update',
] as const

const TTS_TOOL_IDS = [
  'elevenlabs_tts',
  'tts_azure',
  'tts_cartesia',
  'tts_deepgram',
  'tts_elevenlabs',
  'tts_google',
  'tts_openai',
  'tts_playht',
] as const

const FILE_TOOL_IDS = [
  'file_append',
  'file_write',
  'file_get',
  'file_read',
  'file_search',
  'file_get_content',
  'file_compress',
  'file_decompress',
  'file_manage_sharing',
  'file_edit',
  'file_fetch',
  'file_parser',
  'file_parser_v2',
  'file_parser_v3',
  'file_list',
  'file_create_folder',
  'file_update_folder',
  'file_delete_folder',
  'file_restore_folder',
  'file_move',
] as const

const UPTIMEROBOT_TOOL_IDS = ['uptimerobot_create_psp', 'uptimerobot_update_psp'] as const

const STT_TOOL_IDS = [
  'stt_assemblyai',
  'stt_assemblyai_v2',
  'stt_deepgram',
  'stt_deepgram_v2',
  'stt_elevenlabs',
  'stt_elevenlabs_v2',
  'stt_gemini',
  'stt_gemini_v2',
  'stt_whisper',
  'stt_whisper_v2',
] as const

const INSTAGRAM_TOOL_IDS = [
  'instagram_download_media',
  'instagram_publish_carousel',
  'instagram_publish_image',
  'instagram_publish_reel',
  'instagram_publish_story',
  'instagram_publish_video',
] as const

const VIDEO_TOOL_IDS = [
  'video_falai',
  'video_luma',
  'video_minimax',
  'video_runway',
  'video_veo',
] as const

const A2A_TOOL_IDS = [
  'a2a_cancel_task',
  'a2a_get_agent_card',
  'a2a_get_task',
  'a2a_send_message',
] as const

const BUFFER_TOOL_IDS = ['buffer_create_post', 'buffer_edit_post'] as const

const GRAFANA_TOOL_IDS = [
  'grafana_check_data_source_health',
  'grafana_update_alert_rule',
  'grafana_update_dashboard',
  'grafana_update_folder',
] as const

const DEPLOYMENTS_TOOL_IDS = [
  'deployments_deploy',
  'deployments_undeploy',
  'deployments_promote',
  'deployments_list_versions',
  'deployments_get_version',
] as const

const CURSOR_TOOL_IDS = ['cursor_download_artifact', 'cursor_download_artifact_v2'] as const

const SFTP_TOOL_IDS = [
  'sftp_delete',
  'sftp_download',
  'sftp_list',
  'sftp_mkdir',
  'sftp_upload',
] as const

const ZOOM_TOOL_IDS = ['zoom_get_meeting_recordings'] as const

const ZOHO_DESK_TOOL_IDS = ['zoho_desk_get_attachment'] as const

const WORDPRESS_TOOL_IDS = ['wordpress_upload_media'] as const

const ELEVENLABS_TOOL_IDS = [
  'elevenlabs_sound_effects',
  'elevenlabs_speech_to_speech',
  'elevenlabs_audio_isolation',
] as const

const JIRA_TOOL_IDS = ['jira_write', 'jira_update', 'jira_add_attachment'] as const

const WHATSAPP_TOOL_IDS = [
  'whatsapp_get_media',
  'whatsapp_send_media',
  'whatsapp_upload_media',
] as const

const TYPEFORM_TOOL_IDS = ['typeform_files'] as const

const DAYTONA_TOOL_IDS = ['daytona_upload_file'] as const

const GOOGLE_SLIDES_TOOL_IDS = ['google_slides_export_presentation'] as const

const GOOGLE_VAULT_TOOL_IDS = ['google_vault_download_export_file'] as const

const GOOGLE_DRIVE_TOOL_IDS = [
  'google_drive_download',
  'google_drive_export',
  'google_drive_move',
  'google_drive_upload',
] as const

const STAGEHAND_TOOL_IDS = ['stagehand_agent', 'stagehand_extract'] as const

const VISION_TOOL_IDS = ['vision_tool', 'vision_tool_v2'] as const

const GITHUB_TOOL_IDS = [
  'github_comment',
  'github_comment_v2',
  'github_latest_commit',
  'github_latest_commit_v2',
] as const

const TWILIO_VOICE_TOOL_IDS = ['twilio_voice_get_recording'] as const

const PERSONA_TOOL_IDS = ['persona_import_accounts'] as const

const SHAREPOINT_TOOL_IDS = ['sharepoint_download_file', 'sharepoint_upload_file'] as const

const QUIVER_TOOL_IDS = ['quiver_text_to_svg', 'quiver_image_to_svg'] as const

const TELEGRAM_TOOL_IDS = ['telegram_send_document'] as const

const MICROSOFT_TEAMS_TOOL_IDS = [
  'microsoft_teams_delete_chat_message',
  'microsoft_teams_write_chat',
  'microsoft_teams_write_channel',
] as const

const BREX_TOOL_IDS = ['brex_match_receipt', 'brex_upload_receipt'] as const

const SAILPOINT_TOOL_IDS = [
  'sailpoint_approve_access_request',
  'sailpoint_cancel_access_request',
  'sailpoint_decide_certification_review_items',
  'sailpoint_get_access_request_config',
  'sailpoint_get_account_selections',
  'sailpoint_get_access_profile',
  'sailpoint_get_access_profile_entitlements',
  'sailpoint_get_access_request_status',
  'sailpoint_get_account',
  'sailpoint_get_account_activity',
  'sailpoint_get_account_entitlements',
  'sailpoint_get_campaign',
  'sailpoint_get_certification',
  'sailpoint_get_entitlement',
  'sailpoint_get_entitlement_request_config',
  'sailpoint_get_identity',
  'sailpoint_get_role',
  'sailpoint_get_role_entitlements',
  'sailpoint_get_source',
  'sailpoint_get_task_status',
  'sailpoint_list_access_profiles',
  'sailpoint_list_account_activities',
  'sailpoint_list_accounts',
  'sailpoint_list_campaigns',
  'sailpoint_list_certification_review_items',
  'sailpoint_list_certifications',
  'sailpoint_list_entitlements',
  'sailpoint_list_identities',
  'sailpoint_list_identity_entitlements',
  'sailpoint_list_pending_access_request_approvals',
  'sailpoint_list_roles',
  'sailpoint_list_sources',
  'sailpoint_load_accounts',
  'sailpoint_load_entitlements',
  'sailpoint_reject_access_request',
  'sailpoint_request_access',
  'sailpoint_search',
  'sailpoint_search_aggregate',
  'sailpoint_search_count',
  'sailpoint_sign_off_certification',
] as const

const LATEX_TOOL_IDS = ['latex_compile'] as const

const ONEDRIVE_TOOL_IDS = ['onedrive_download', 'onedrive_upload'] as const

const VANTA_TOOL_IDS = [
  'vanta_download_document_file',
  'vanta_get_control',
  'vanta_get_document',
  'vanta_get_framework',
  'vanta_get_person',
  'vanta_get_policy',
  'vanta_get_risk_scenario',
  'vanta_get_test',
  'vanta_get_vendor',
  'vanta_get_vulnerable_asset',
  'vanta_list_control_documents',
  'vanta_list_control_tests',
  'vanta_list_controls',
  'vanta_list_document_uploads',
  'vanta_list_documents',
  'vanta_list_framework_controls',
  'vanta_list_frameworks',
  'vanta_list_monitored_computers',
  'vanta_list_people',
  'vanta_list_policies',
  'vanta_list_risk_scenarios',
  'vanta_list_test_entities',
  'vanta_list_tests',
  'vanta_list_vendors',
  'vanta_list_vulnerabilities',
  'vanta_list_vulnerability_remediations',
  'vanta_list_vulnerable_assets',
  'vanta_submit_document',
  'vanta_upload_document_file',
] as const

const SAP_S4HANA_TOOL_IDS = [
  'sap_s4hana_create_business_partner',
  'sap_s4hana_create_purchase_order',
  'sap_s4hana_create_purchase_requisition',
  'sap_s4hana_create_sales_order',
  'sap_s4hana_delete_sales_order',
  'sap_s4hana_get_billing_document',
  'sap_s4hana_get_business_partner',
  'sap_s4hana_get_customer',
  'sap_s4hana_get_inbound_delivery',
  'sap_s4hana_get_material_document',
  'sap_s4hana_get_outbound_delivery',
  'sap_s4hana_get_product',
  'sap_s4hana_get_purchase_order',
  'sap_s4hana_get_purchase_requisition',
  'sap_s4hana_get_sales_order',
  'sap_s4hana_get_supplier',
  'sap_s4hana_get_supplier_invoice',
  'sap_s4hana_list_billing_documents',
  'sap_s4hana_list_business_partners',
  'sap_s4hana_list_customers',
  'sap_s4hana_list_inbound_deliveries',
  'sap_s4hana_list_material_documents',
  'sap_s4hana_list_material_stock',
  'sap_s4hana_list_outbound_deliveries',
  'sap_s4hana_list_products',
  'sap_s4hana_list_purchase_orders',
  'sap_s4hana_list_purchase_requisitions',
  'sap_s4hana_list_sales_orders',
  'sap_s4hana_list_supplier_invoices',
  'sap_s4hana_list_suppliers',
  'sap_s4hana_odata_query',
  'sap_s4hana_update_business_partner',
  'sap_s4hana_update_customer',
  'sap_s4hana_update_product',
  'sap_s4hana_update_purchase_order',
  'sap_s4hana_update_purchase_requisition',
  'sap_s4hana_update_sales_order',
  'sap_s4hana_update_supplier',
] as const

const AZURE_DATA_EXPLORER_TOOL_IDS = [
  'azure_data_explorer_create_table',
  'azure_data_explorer_drop_table',
  'azure_data_explorer_ingest_from_query',
  'azure_data_explorer_ingest_inline',
  'azure_data_explorer_list_databases',
  'azure_data_explorer_list_functions',
  'azure_data_explorer_list_tables',
  'azure_data_explorer_management',
  'azure_data_explorer_query',
  'azure_data_explorer_show_database_schema',
  'azure_data_explorer_show_ingestion_failures',
  'azure_data_explorer_show_operations',
  'azure_data_explorer_show_table_details',
  'azure_data_explorer_show_table_schema',
] as const

const ZOOMINFO_TOOL_IDS = [
  'zoominfo_enrich_companies',
  'zoominfo_enrich_contacts',
  'zoominfo_search_companies',
  'zoominfo_search_contacts',
  'zoominfo_search_intent',
  'zoominfo_search_news',
] as const

const SAP_CONCUR_TOOL_IDS = [
  'sap_concur_approve_expense_report',
  'sap_concur_associate_attendees',
  'sap_concur_create_cash_advance',
  'sap_concur_create_expected_expense',
  'sap_concur_create_expense_report',
  'sap_concur_create_list_item',
  'sap_concur_create_purchase_request',
  'sap_concur_create_quick_expense',
  'sap_concur_create_quick_expense_with_image',
  'sap_concur_create_report_comment',
  'sap_concur_create_travel_request',
  'sap_concur_create_user',
  'sap_concur_delete_expected_expense',
  'sap_concur_delete_expense',
  'sap_concur_delete_expense_report',
  'sap_concur_delete_list_item',
  'sap_concur_delete_travel_request',
  'sap_concur_delete_user',
  'sap_concur_get_allocation',
  'sap_concur_get_budget',
  'sap_concur_get_cash_advance',
  'sap_concur_get_expected_expense',
  'sap_concur_get_expense',
  'sap_concur_get_expense_report',
  'sap_concur_get_itemizations',
  'sap_concur_get_itinerary',
  'sap_concur_get_list',
  'sap_concur_get_list_item',
  'sap_concur_get_purchase_request',
  'sap_concur_get_receipt',
  'sap_concur_get_receipt_status',
  'sap_concur_get_request_cash_advance',
  'sap_concur_get_travel_profile',
  'sap_concur_get_travel_request',
  'sap_concur_get_user',
  'sap_concur_issue_cash_advance',
  'sap_concur_list_allocations',
  'sap_concur_list_attendee_associations',
  'sap_concur_list_budget_categories',
  'sap_concur_list_budgets',
  'sap_concur_list_exceptions',
  'sap_concur_list_expected_expenses',
  'sap_concur_list_expense_reports',
  'sap_concur_list_expenses',
  'sap_concur_list_itineraries',
  'sap_concur_list_list_items',
  'sap_concur_list_lists',
  'sap_concur_list_receipts',
  'sap_concur_list_report_comments',
  'sap_concur_list_reports_to_approve',
  'sap_concur_list_travel_profiles_summary',
  'sap_concur_list_travel_request_comments',
  'sap_concur_list_travel_requests',
  'sap_concur_list_users',
  'sap_concur_move_travel_request',
  'sap_concur_recall_expense_report',
  'sap_concur_remove_all_attendees',
  'sap_concur_search_locations',
  'sap_concur_search_users',
  'sap_concur_send_back_expense_report',
  'sap_concur_submit_expense_report',
  'sap_concur_update_allocation',
  'sap_concur_update_expected_expense',
  'sap_concur_update_expense',
  'sap_concur_update_expense_report',
  'sap_concur_update_list_item',
  'sap_concur_update_travel_request',
  'sap_concur_update_user',
  'sap_concur_upload_exchange_rates',
  'sap_concur_upload_receipt_image',
] as const

const RESEND_TOOL_IDS = ['resend_send'] as const

const SENDGRID_TOOL_IDS = ['sendgrid_send_mail'] as const

const SMTP_TOOL_IDS = ['smtp_send_mail'] as const

const BOX_TOOL_IDS = ['box_upload_file'] as const

const DROPBOX_TOOL_IDS = ['dropbox_upload'] as const

const FIREFLIES_TOOL_IDS = ['fireflies_upload_audio'] as const

const SUPABASE_TOOL_IDS = [
  'supabase_storage_get_public_url',
  'supabase_storage_update_bucket',
  'supabase_storage_upload',
] as const

const SQUARE_TOOL_IDS = ['square_create_catalog_image'] as const

const TIKTOK_TOOL_IDS = ['tiktok_upload_video_draft'] as const

const IMAGE_TOOL_IDS = ['image_generate'] as const

const EMBEDDINGS_TOOL_IDS = [
  'embeddings_openai',
  'embeddings_openrouter',
  'embeddings_gemini',
  'embeddings_cohere',
  'embeddings_mistral',
  'embeddings_ollama',
  'openai_embeddings',
] as const

const ENRICHMENT_TOOL_IDS = ['enrichment_run'] as const

const LLM_TOOL_IDS = ['llm_chat'] as const

const GUARDRAILS_TOOL_IDS = ['guardrails_validate'] as const

const MISTRAL_TOOL_IDS = ['mistral_parser', 'mistral_parser_v2', 'mistral_parser_v3'] as const

const REDUCTO_TOOL_IDS = ['reducto_parser', 'reducto_parser_v2'] as const

const PULSE_TOOL_IDS = ['pulse_parser', 'pulse_parser_v2'] as const

const EXTEND_TOOL_IDS = ['extend_parser', 'extend_parser_v2'] as const

const FIRECRAWL_TOOL_IDS = ['firecrawl_parse'] as const

const CLICKUP_TOOL_IDS = ['clickup_upload_attachment'] as const

const DISCORD_TOOL_IDS = ['discord_send_message'] as const

const LINQ_TOOL_IDS = ['linq_create_attachment'] as const

const ASHBY_TOOL_IDS = ['ashby_upload_candidate_file', 'ashby_upload_resume'] as const

const MICROSOFT_DATAVERSE_TOOL_IDS = ['microsoft_dataverse_upload_file'] as const

const SERVICENOW_TOOL_IDS = ['servicenow_upload_attachment'] as const

const PIPEDRIVE_TOOL_IDS = ['pipedrive_get_files'] as const

const MEMORY_TOOL_IDS = ['memory_add', 'memory_delete', 'memory_get', 'memory_get_all'] as const

const LOG_TOOL_IDS = [
  'logs_get_execution',
  'logs_get',
  'logs_get_run_details',
  'logs_query',
  'logs_query_runs',
] as const

function registerFamily(
  registry: Map<string, InternalToolOperationHandlerLoader>,
  toolIds: readonly string[],
  loader: InternalToolOperationHandlerLoader
): void {
  for (const toolId of toolIds) {
    if (registry.has(toolId)) {
      throw new Error(`Duplicate internal tool execution registration: ${toolId}`)
    }
    registry.set(toolId, loader)
  }
}

const handlerLoaders = new Map<string, InternalToolOperationHandlerLoader>()

registerFamily(handlerLoaders, ASHBY_TOOL_IDS, async () => {
  return (await import('@/lib/internal/ashby/execute-tool')).executeAshbyTool
})

registerFamily(handlerLoaders, STS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sts/execute-tool')).executeStsTool
})
registerFamily(handlerLoaders, APPCONFIG_TOOL_IDS, async () => {
  return (await import('@/lib/internal/appconfig/execute-tool')).executeAppConfigTool
})
registerFamily(handlerLoaders, IAM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/iam/execute-tool')).executeIamTool
})
registerFamily(handlerLoaders, IDENTITY_CENTER_TOOL_IDS, async () => {
  return (await import('@/lib/internal/identity-center/execute-tool')).executeIdentityCenterTool
})
registerFamily(handlerLoaders, SECRETS_MANAGER_TOOL_IDS, async () => {
  return (await import('@/lib/internal/secrets-manager/execute-tool')).executeSecretsManagerTool
})
registerFamily(handlerLoaders, SSM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/ssm/execute-tool')).executeSsmTool
})
registerFamily(handlerLoaders, DYNAMODB_TOOL_IDS, async () => {
  return (await import('@/lib/internal/dynamodb/execute-tool')).executeDynamodbTool
})
registerFamily(handlerLoaders, SES_TOOL_IDS, async () => {
  return (await import('@/lib/internal/ses/execute-tool')).executeSesTool
})
registerFamily(handlerLoaders, SQS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sqs/execute-tool')).executeSqsTool
})
registerFamily(handlerLoaders, RDS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/rds/execute-tool')).executeRdsTool
})
registerFamily(handlerLoaders, TEXTRACT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/textract/execute-tool')).executeTextractTool
})
registerFamily(handlerLoaders, CLOUDWATCH_TOOL_IDS, async () => {
  return (await import('@/lib/internal/cloudwatch/execute-tool')).executeCloudwatchTool
})
registerFamily(handlerLoaders, CLOUDTRAIL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/cloudtrail/execute-tool')).executeCloudtrailTool
})
registerFamily(handlerLoaders, POSTGRESQL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/postgresql/execute-tool')).executePostgresqlTool
})
registerFamily(handlerLoaders, REDIS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/redis/execute-tool')).executeRedisTool
})
registerFamily(handlerLoaders, CLOUDFORMATION_TOOL_IDS, async () => {
  return (await import('@/lib/internal/cloudformation/execute-tool')).executeCloudformationTool
})
registerFamily(handlerLoaders, LAMBDA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/lambda/execute-tool')).executeLambdaTool
})
registerFamily(handlerLoaders, CODEPIPELINE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/codepipeline/execute-tool')).executeCodepipelineTool
})
registerFamily(handlerLoaders, MYSQL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/mysql/execute-tool')).executeMysqlTool
})
registerFamily(handlerLoaders, ATHENA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/athena/execute-tool')).executeAthenaTool
})
registerFamily(handlerLoaders, CLICKHOUSE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/clickhouse/execute-tool')).executeClickHouseTool
})
registerFamily(handlerLoaders, MONGODB_TOOL_IDS, async () => {
  return (await import('@/lib/internal/mongodb/execute-tool')).executeMongodbTool
})
registerFamily(handlerLoaders, NEO4J_TOOL_IDS, async () => {
  return (await import('@/lib/internal/neo4j/execute-tool')).executeNeo4jTool
})
registerFamily(handlerLoaders, S3_TOOL_IDS, async () => {
  return (await import('@/lib/internal/s3/execute-tool')).executeS3Tool
})
registerFamily(handlerLoaders, JUPYTER_TOOL_IDS, async () => {
  return (await import('@/lib/internal/jupyter/execute-tool')).executeJupyterTool
})
registerFamily(handlerLoaders, MSSQL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/mssql/execute-tool')).executeMssqlTool
})
registerFamily(handlerLoaders, KNOWLEDGE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/knowledge/execute-tool')).executeKnowledgeTool
})
registerFamily(handlerLoaders, CONFLUENCE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/confluence/execute-tool')).executeConfluenceTool
})
registerFamily(handlerLoaders, JSM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/jsm/execute-tool')).executeJsmTool
})
registerFamily(handlerLoaders, CROWDSTRIKE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/crowdstrike/execute-tool')).executeCrowdStrikeTool
})
registerFamily(handlerLoaders, GMAIL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/gmail/execute-tool')).executeGmailTool
})
registerFamily(handlerLoaders, WINDCHILL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/windchill/execute-tool')).executeWindchillTool
})
registerFamily(handlerLoaders, TABLE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/table/execute-tool')).executeTableTool
})
registerFamily(handlerLoaders, WORKDAY_TOOL_IDS, async () => {
  return (await import('@/lib/internal/workday/execute-tool')).executeWorkdayTool
})
registerFamily(handlerLoaders, AGILOFT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/agiloft/execute-tool')).executeAgiloftTool
})
registerFamily(handlerLoaders, ONEPASSWORD_TOOL_IDS, async () => {
  return (await import('@/lib/internal/onepassword/execute-tool')).executeOnePasswordTool
})
registerFamily(handlerLoaders, OUTLOOK_TOOL_IDS, async () => {
  return (await import('@/lib/internal/outlook/execute-tool')).executeOutlookTool
})
registerFamily(handlerLoaders, SSH_TOOL_IDS, async () => {
  return (await import('@/lib/internal/ssh/execute-tool')).executeSshTool
})
registerFamily(handlerLoaders, ASANA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/asana/execute-tool')).executeAsanaTool
})
registerFamily(handlerLoaders, DOCUSIGN_TOOL_IDS, async () => {
  return (await import('@/lib/internal/docusign/execute-tool')).executeDocuSignTool
})
registerFamily(handlerLoaders, QUICKBOOKS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/quickbooks/execute-tool')).executeQuickBooksTool
})
registerFamily(handlerLoaders, THINKING_TOOL_IDS, async () => {
  return (await import('@/lib/internal/thinking/execute-tool')).executeThinkingTool
})
registerFamily(handlerLoaders, BITBUCKET_TOOL_IDS, async () => {
  return (await import('@/lib/internal/bitbucket/execute-tool')).executeBitbucketTool
})
registerFamily(handlerLoaders, BROWSER_USE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/browser-use/execute-tool')).executeBrowserUseTool
})
registerFamily(handlerLoaders, CBINSIGHTS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/cbinsights/execute-tool')).executeCbinsightsTool
})
registerFamily(handlerLoaders, CLOUDFLARE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/cloudflare/execute-tool')).executeCloudflareTool
})
registerFamily(handlerLoaders, DATADOG_TOOL_IDS, async () => {
  return (await import('@/lib/internal/datadog/execute-tool')).executeDatadogTool
})
registerFamily(handlerLoaders, MANAGED_AGENT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/managed-agent/execute-tool')).executeManagedAgentTool
})
registerFamily(handlerLoaders, MICROSOFT_AD_TOOL_IDS, async () => {
  return (await import('@/lib/internal/microsoft-ad/execute-tool')).executeMicrosoftAdTool
})
registerFamily(handlerLoaders, NETSUITE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/netsuite/execute-tool')).executeNetsuiteTool
})
registerFamily(handlerLoaders, OKTA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/okta/execute-tool')).executeOktaTool
})
registerFamily(handlerLoaders, SALESFORCE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/salesforce/execute-tool')).executeSalesforceTool
})
registerFamily(handlerLoaders, SLACK_TOOL_IDS, async () => {
  return (await import('@/lib/internal/slack/execute-tool')).executeSlackTool
})
registerFamily(handlerLoaders, SEARCH_TOOL_IDS, async () => {
  return (await import('@/lib/internal/search/execute-tool')).executeSearchTool
})
registerFamily(handlerLoaders, SMS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sms/execute-tool')).executeSmsTool
})
registerFamily(handlerLoaders, MICROSOFT_WORD_TOOL_IDS, async () => {
  return (await import('@/lib/internal/microsoft-word/execute-tool')).executeMicrosoftWordTool
})
registerFamily(handlerLoaders, TTS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/tts/execute-tool')).executeTtsTool
})
registerFamily(handlerLoaders, FILE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/file/execute-tool')).executeFileTool
})
registerFamily(handlerLoaders, UPTIMEROBOT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/uptimerobot/execute-tool')).executeUptimeRobotTool
})
registerFamily(handlerLoaders, STT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/stt/execute-tool')).executeSttTool
})
registerFamily(handlerLoaders, INSTAGRAM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/instagram/execute-tool')).executeInstagramTool
})
registerFamily(handlerLoaders, VIDEO_TOOL_IDS, async () => {
  return (await import('@/lib/internal/video/execute-tool')).executeVideoTool
})
registerFamily(handlerLoaders, A2A_TOOL_IDS, async () => {
  return (await import('@/lib/internal/a2a/execute-tool')).executeA2ATool
})
registerFamily(handlerLoaders, BUFFER_TOOL_IDS, async () => {
  return (await import('@/lib/internal/buffer/execute-tool')).executeBufferTool
})
registerFamily(handlerLoaders, GRAFANA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/grafana/execute-tool')).executeGrafanaTool
})
registerFamily(handlerLoaders, DEPLOYMENTS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/deployments/execute-tool')).executeDeploymentsTool
})
registerFamily(handlerLoaders, CURSOR_TOOL_IDS, async () => {
  return (await import('@/lib/internal/cursor/execute-tool')).executeCursorTool
})
registerFamily(handlerLoaders, SFTP_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sftp/execute-tool')).executeSftpTool
})
registerFamily(handlerLoaders, ZOOM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/zoom/execute-tool')).executeZoomTool
})
registerFamily(handlerLoaders, ZOHO_DESK_TOOL_IDS, async () => {
  return (await import('@/lib/internal/zoho-desk/execute-tool')).executeZohoDeskTool
})
registerFamily(handlerLoaders, WORDPRESS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/wordpress/execute-tool')).executeWordPressTool
})
registerFamily(handlerLoaders, ELEVENLABS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/elevenlabs/execute-tool')).executeElevenLabsTool
})
registerFamily(handlerLoaders, JIRA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/jira/execute-tool')).executeJiraTool
})
registerFamily(handlerLoaders, WHATSAPP_TOOL_IDS, async () => {
  return (await import('@/lib/internal/whatsapp/execute-tool')).executeWhatsAppTool
})
registerFamily(handlerLoaders, TYPEFORM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/typeform/execute-tool')).executeTypeformTool
})
registerFamily(handlerLoaders, DAYTONA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/daytona/execute-tool')).executeDaytonaTool
})
registerFamily(handlerLoaders, GOOGLE_SLIDES_TOOL_IDS, async () => {
  return (await import('@/lib/internal/google-slides/execute-tool')).executeGoogleSlidesTool
})
registerFamily(handlerLoaders, GOOGLE_VAULT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/google-vault/execute-tool')).executeGoogleVaultTool
})
registerFamily(handlerLoaders, GOOGLE_DRIVE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/google-drive/execute-tool')).executeGoogleDriveTool
})
registerFamily(handlerLoaders, STAGEHAND_TOOL_IDS, async () => {
  return (await import('@/lib/internal/stagehand/execute-tool')).executeStagehandTool
})
registerFamily(handlerLoaders, VISION_TOOL_IDS, async () => {
  return (await import('@/lib/internal/vision/execute-tool')).executeVisionTool
})
registerFamily(handlerLoaders, GITHUB_TOOL_IDS, async () => {
  return (await import('@/lib/internal/github/execute-tool')).executeGitHubTool
})
registerFamily(handlerLoaders, TWILIO_VOICE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/twilio-voice/execute-tool')).executeTwilioVoiceTool
})
registerFamily(handlerLoaders, PERSONA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/persona/execute-tool')).executePersonaTool
})
registerFamily(handlerLoaders, SHAREPOINT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sharepoint/execute-tool')).executeSharePointTool
})
registerFamily(handlerLoaders, QUIVER_TOOL_IDS, async () => {
  return (await import('@/lib/internal/quiver/execute-tool')).executeQuiverTool
})
registerFamily(handlerLoaders, TELEGRAM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/telegram/execute-tool')).executeTelegramTool
})
registerFamily(handlerLoaders, MICROSOFT_TEAMS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/microsoft-teams/execute-tool')).executeMicrosoftTeamsTool
})
registerFamily(handlerLoaders, BREX_TOOL_IDS, async () => {
  return (await import('@/lib/internal/brex/execute-tool')).executeBrexTool
})
registerFamily(handlerLoaders, SAILPOINT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sailpoint/execute-tool')).executeSailPointTool
})
registerFamily(handlerLoaders, LATEX_TOOL_IDS, async () => {
  return (await import('@/lib/internal/latex/execute-tool')).executeLatexTool
})
registerFamily(handlerLoaders, ONEDRIVE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/onedrive/execute-tool')).executeOneDriveTool
})
registerFamily(handlerLoaders, VANTA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/vanta/execute-tool')).executeVantaTool
})
registerFamily(handlerLoaders, SAP_S4HANA_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sap-s4hana/execute-tool')).executeSapS4HanaTool
})
registerFamily(handlerLoaders, AZURE_DATA_EXPLORER_TOOL_IDS, async () => {
  return (await import('@/lib/internal/azure-data-explorer/execute-tool'))
    .executeAzureDataExplorerTool
})
registerFamily(handlerLoaders, ZOOMINFO_TOOL_IDS, async () => {
  return (await import('@/lib/internal/zoominfo/execute-tool')).executeZoomInfoTool
})
registerFamily(handlerLoaders, SAP_CONCUR_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sap-concur/execute-tool')).executeSapConcurTool
})
registerFamily(handlerLoaders, RESEND_TOOL_IDS, async () => {
  return (await import('@/lib/internal/resend/execute-tool')).executeResendTool
})
registerFamily(handlerLoaders, SENDGRID_TOOL_IDS, async () => {
  return (await import('@/lib/internal/sendgrid/execute-tool')).executeSendGridTool
})
registerFamily(handlerLoaders, SMTP_TOOL_IDS, async () => {
  return (await import('@/lib/internal/smtp/execute-tool')).executeSmtpTool
})
registerFamily(handlerLoaders, BOX_TOOL_IDS, async () => {
  return (await import('@/lib/internal/box/execute-tool')).executeBoxTool
})
registerFamily(handlerLoaders, DROPBOX_TOOL_IDS, async () => {
  return (await import('@/lib/internal/dropbox/execute-tool')).executeDropboxTool
})
registerFamily(handlerLoaders, FIREFLIES_TOOL_IDS, async () => {
  return (await import('@/lib/internal/fireflies/execute-tool')).executeFirefliesTool
})
registerFamily(handlerLoaders, SUPABASE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/supabase/execute-tool')).executeSupabaseTool
})
registerFamily(handlerLoaders, SQUARE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/square/execute-tool')).executeSquareTool
})
registerFamily(handlerLoaders, TIKTOK_TOOL_IDS, async () => {
  return (await import('@/lib/internal/tiktok/execute-tool')).executeTikTokTool
})
registerFamily(handlerLoaders, IMAGE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/image/execute-tool')).executeImageTool
})
registerFamily(handlerLoaders, EMBEDDINGS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/embeddings/execute-tool')).executeEmbeddingsTool
})
registerFamily(handlerLoaders, ENRICHMENT_TOOL_IDS, async () => {
  return (await import('@/lib/internal/enrichment/execute-tool')).executeEnrichmentTool
})
registerFamily(handlerLoaders, LLM_TOOL_IDS, async () => {
  return (await import('@/lib/internal/llm/execute-tool')).executeLlmTool
})
registerFamily(handlerLoaders, GUARDRAILS_TOOL_IDS, async () => {
  return (await import('@/lib/internal/guardrails/execute-tool')).executeGuardrailsTool
})
registerFamily(handlerLoaders, MISTRAL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/mistral/execute-tool')).executeMistralTool
})
registerFamily(handlerLoaders, REDUCTO_TOOL_IDS, async () => {
  return (await import('@/lib/internal/reducto/execute-tool')).executeReductoTool
})
registerFamily(handlerLoaders, PULSE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/pulse/execute-tool')).executePulseTool
})
registerFamily(handlerLoaders, EXTEND_TOOL_IDS, async () => {
  return (await import('@/lib/internal/extend/execute-tool')).executeExtendTool
})
registerFamily(handlerLoaders, FIRECRAWL_TOOL_IDS, async () => {
  return (await import('@/lib/internal/firecrawl/execute-tool')).executeFirecrawlTool
})
registerFamily(handlerLoaders, CLICKUP_TOOL_IDS, async () => {
  return (await import('@/lib/internal/clickup/execute-tool')).executeClickUpTool
})
registerFamily(handlerLoaders, DISCORD_TOOL_IDS, async () => {
  return (await import('@/lib/internal/discord/execute-tool')).executeDiscordTool
})
registerFamily(handlerLoaders, LINQ_TOOL_IDS, async () => {
  return (await import('@/lib/internal/linq/execute-tool')).executeLinqTool
})
registerFamily(handlerLoaders, MICROSOFT_DATAVERSE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/microsoft-dataverse/execute-tool'))
    .executeMicrosoftDataverseTool
})
registerFamily(handlerLoaders, SERVICENOW_TOOL_IDS, async () => {
  return (await import('@/lib/internal/servicenow/execute-tool')).executeServiceNowTool
})
registerFamily(handlerLoaders, PIPEDRIVE_TOOL_IDS, async () => {
  return (await import('@/lib/internal/pipedrive/execute-tool')).executePipedriveTool
})
registerFamily(handlerLoaders, MEMORY_TOOL_IDS, async () => {
  return (await import('@/lib/internal/memory/execute-tool')).executeMemoryTool
})
registerFamily(handlerLoaders, LOG_TOOL_IDS, async () => {
  return (await import('@/lib/internal/logs/execute-tool')).executeLogsTool
})

export function isInternalToolOperationRegistered(toolId: string): boolean {
  return handlerLoaders.has(toolId) || isMcpTool(toolId)
}

export function getRegisteredInternalToolOperationIds(): string[] {
  return [...handlerLoaders.keys()]
}

export async function getInternalToolOperationHandler(
  toolId: string
): Promise<InternalToolOperationHandler | null> {
  const loader = handlerLoaders.get(toolId)
  if (loader) return loader()
  if (isMcpTool(toolId)) {
    return (await import('@/lib/internal/mcp/execute-tool')).executeMcpTool
  }
  return null
}
