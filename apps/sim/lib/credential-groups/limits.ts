export const CREDENTIAL_GROUP_MCP_SERVER_LIMIT = 50
export const ORGANIZATION_VIEWER_ACCOUNT_LIMIT = 100
export const ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT = 1000
export const CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT = 50
export const CREDENTIAL_GROUP_WORKFLOW_CATALOG_LIMIT = 500
export const CREDENTIAL_GROUP_WORKFLOW_NAME_MAX_LENGTH = 255
/** Knowledge connectors one credential option may back at once. */
export const CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT = 32
export const ORGANIZATION_ACCOUNT_INDEXING_SOURCE_LIMIT = 100
/** Live accounts one member may connect per provider; bounds a search's per-account fan-out. */
export const CREDENTIAL_GROUP_ACCOUNTS_PER_PROVIDER_LIMIT = 5
/** Bounds on the sites recorded for one account, enforced wherever they are written or read. */
export const ACCOUNT_SITE_LIMIT = 50
export const ACCOUNT_SITE_NAME_MAX_LENGTH = 512
export const ACCOUNT_SITE_URL_MAX_LENGTH = 2048
