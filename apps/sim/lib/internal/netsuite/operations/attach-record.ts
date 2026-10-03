import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { NetSuiteAttachParams } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  normalizeRelatedType,
  optionalTrim,
} from '@/tools/netsuite/utils'

export const executeNetsuiteAttachRecordOperation: InternalToolOperationImplementation<
  NetSuiteAttachParams
> = (params, signal) =>
  executeNetSuiteRequest(
    params,
    () => {
      const relatedType = normalizeRelatedType(params.relatedType)
      const roleId = optionalTrim(params.roleId)
      const roleExternalId = optionalTrim(params.roleExternalId)
      if (roleId && roleExternalId) {
        throw new Error('Provide either a contact role ID or external ID, not both')
      }
      if (relatedType === 'file' && (roleId || roleExternalId)) {
        throw new Error('Contact roles cannot be provided when attaching a file')
      }
      return {
        method: 'POST',
        path: buildRecordPath(
          { value: params.recordType, label: 'Record type' },
          { value: params.recordId, label: 'Record ID' },
          { value: '!attach', label: 'Attach operation' },
          { value: relatedType, label: 'Related type' },
          { value: params.relatedId, label: 'Related ID' }
        ),
        success: { status: 204, body: 'none' },
        body: roleId
          ? { role: { id: roleId } }
          : roleExternalId
            ? { role: { externalId: roleExternalId } }
            : {},
      }
    },
    signal
  )
