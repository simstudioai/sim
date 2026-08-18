import type { NetSuiteAttachParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  buildRecordPath,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  normalizeRelatedType,
  optionalTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteAttachRecordTool: ToolConfig<NetSuiteAttachParams, NetSuiteResponse> = {
  id: 'netsuite_attach_record',
  name: 'NetSuite Attach Record or File',
  description: 'Attach a contact or file to another NetSuite record.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    recordType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite REST record type script ID, such as customer or salesOrder',
    },
    recordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'NetSuite internal ID or an external-ID reference beginning with eid:',
    },
    relatedType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Related resource type: contact or file',
    },
    relatedId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Internal ID, or external ID prefixed with eid:, of the contact or file',
    },
    roleId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional contact role internal ID',
    },
    roleExternalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional contact role external ID',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
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
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'Empty for the documented HTTP 204 No Content response',
      nullable: true,
    },
  },
}
