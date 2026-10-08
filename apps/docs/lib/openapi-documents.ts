import type { OPENAPI_SPEC_FILES } from '@/lib/openapi-specs'
import billingSpec from '@/openapi-v2-billing.json'
import filesAuditSpec from '@/openapi-v2-files-audit.json'
import knowledgeSpec from '@/openapi-v2-knowledge.json'
import logsSpec from '@/openapi-v2-logs.json'
import resourcesSpec from '@/openapi-v2-resources.json'
import tablesSpec from '@/openapi-v2-tables.json'
import workflowsSpec from '@/openapi-v2-workflows.json'

export const OPENAPI_DOCUMENTS_BY_FILE = {
  'openapi-v2-billing.json': billingSpec,
  'openapi-v2-files-audit.json': filesAuditSpec,
  'openapi-v2-knowledge.json': knowledgeSpec,
  'openapi-v2-logs.json': logsSpec,
  'openapi-v2-resources.json': resourcesSpec,
  'openapi-v2-tables.json': tablesSpec,
  'openapi-v2-workflows.json': workflowsSpec,
} satisfies Record<(typeof OPENAPI_SPEC_FILES)[number], Record<string, unknown>>
