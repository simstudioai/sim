import type { OracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { getAdminJobStatus } from '@/lib/internal/oracle-epm-platform/jobs'
import { environmentToolHandlers } from '@/lib/internal/oracle-epm-platform/operations/environment'
import { identityToolHandlers } from '@/lib/internal/oracle-epm-platform/operations/identity'
import { repositoryToolHandlers } from '@/lib/internal/oracle-epm-platform/operations/repository'
import type { OracleEpmPlatformInput } from '@/lib/internal/oracle-epm-platform/schemas'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type {
  OracleEpmPlatformOperation,
  OracleEpmPlatformOutputMap,
} from '@/tools/oracle_epm_platform/types'

export interface OracleEpmPlatformOperationContext {
  client: OracleEpmClient
  signal?: AbortSignal
  execution?: InternalToolOperationContext
}
export type OracleEpmPlatformOperationImplementations = {
  [K in OracleEpmPlatformOperation]: (
    input: OracleEpmPlatformInput<K>,
    context: OracleEpmPlatformOperationContext
  ) => Promise<OracleEpmPlatformOutputMap[K]>
}

export const oracleEpmPlatformToolHandlers: OracleEpmPlatformOperationImplementations = {
  ...environmentToolHandlers,
  ...identityToolHandlers,
  ...repositoryToolHandlers,
  get_admin_job_status: (input, { client, signal }) => getAdminJobStatus(client, input, signal),
}
