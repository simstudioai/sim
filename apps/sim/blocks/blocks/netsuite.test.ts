/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { NETSUITE_TOOL_IDS, NetSuiteBlock } from '@/blocks/blocks/netsuite'
import type { SubBlockConfig } from '@/blocks/types'
import * as netsuiteTools from '@/tools/netsuite'
import type { ToolConfig } from '@/tools/types'

function getSubBlock(id: string) {
  const subBlock = NetSuiteBlock.subBlocks.find((candidate) => candidate.id === id)
  if (!subBlock) throw new Error(`Missing NetSuite sub-block ${id}`)
  return subBlock
}

function isNetSuiteTool(value: unknown): value is ToolConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.startsWith('netsuite_') &&
    'request' in value
  )
}

const NETSUITE_TOOLS_BY_ID = new Map(
  Object.values(netsuiteTools)
    .filter(isNetSuiteTool)
    .map((tool) => [tool.id, tool])
)

const PARAM_ALIASES: Partial<Record<(typeof NETSUITE_TOOL_IDS)[number], Record<string, string>>> = {
  netsuite_get_async_status: { statusTaskId: 'taskId' },
  netsuite_get_async_result: { resultTaskId: 'taskId' },
}

function toolParamId(operation: string, subBlock: SubBlockConfig): string {
  const publishedId = subBlock.canonicalParamId ?? subBlock.id
  return (
    PARAM_ALIASES[operation as (typeof NETSUITE_TOOL_IDS)[number]]?.[publishedId] ?? publishedId
  )
}

function blockInputId(subBlock: SubBlockConfig): string {
  return subBlock.canonicalParamId ?? subBlock.id
}

function conditionIncludesOperation(condition: unknown, operation: string): boolean {
  if (!condition || typeof condition !== 'object') return true
  const candidate = condition as { field?: unknown; not?: unknown; value?: unknown }
  if (candidate.field !== 'operation') return true
  const values = Array.isArray(candidate.value) ? candidate.value : [candidate.value]
  const included = values.includes(operation)
  return candidate.not ? !included : included
}

function requiredForOperation(required: unknown, operation: string): boolean {
  if (required === true) return true
  return conditionIncludesOperation(required, operation) && Boolean(required)
}

function requiredForWholeOperation(required: unknown, operation: string): boolean {
  if (required === true) return true
  if (!required || typeof required !== 'object') return false
  const candidate = required as { and?: unknown }
  return candidate.and === undefined && requiredForOperation(required, operation)
}

function referencedOperations(rule: unknown): string[] {
  if (!rule || typeof rule !== 'object') return []
  const candidate = rule as { and?: unknown; field?: unknown; value?: unknown }
  const own =
    candidate.field === 'operation'
      ? (Array.isArray(candidate.value) ? candidate.value : [candidate.value]).filter(
          (value): value is string => typeof value === 'string'
        )
      : []
  return [...own, ...referencedOperations(candidate.and)]
}

function subBlocksForParam(operation: string, param: string): SubBlockConfig[] {
  return NetSuiteBlock.subBlocks.filter(
    (subBlock) =>
      subBlock.id !== 'operation' &&
      toolParamId(operation, subBlock) === param &&
      conditionIncludesOperation(subBlock.condition, operation)
  )
}

describe('Oracle NetSuite block', () => {
  it('keeps dropdown operations, tool access, exports, and selection aligned', () => {
    const operation = getSubBlock('operation')
    const options =
      typeof operation.options === 'function' ? operation.options() : operation.options
    const optionIds = options?.map((option) => option.id) ?? []

    expect(optionIds).toEqual([...NETSUITE_TOOL_IDS])
    expect(NetSuiteBlock.tools.access).toEqual([...NETSUITE_TOOL_IDS])
    expect([...NETSUITE_TOOLS_BY_ID.keys()].sort()).toEqual([...NETSUITE_TOOL_IDS].sort())
    const selectTool = NetSuiteBlock.tools.config.tool
    for (const toolId of NETSUITE_TOOL_IDS) {
      expect(selectTool({ operation: toolId })).toBe(toolId)
    }
  })

  it('derives a complete and type-safe operation-to-input contract', () => {
    const problems: string[] = []
    const subBlockIds = NetSuiteBlock.subBlocks.map((subBlock) => subBlock.id)
    const publishedInputIds = new Set(NetSuiteBlock.subBlocks.map(blockInputId))
    expect(new Set(subBlockIds).size, 'duplicate sub-block id').toBe(subBlockIds.length)
    for (const input of Object.keys(NetSuiteBlock.inputs)) {
      if (!publishedInputIds.has(input)) problems.push(`${input}: block input has no sub-block`)
    }
    for (const subBlock of NetSuiteBlock.subBlocks) {
      if (subBlock.id === 'operation') continue
      const publishedId = blockInputId(subBlock)
      if (!(publishedId in NetSuiteBlock.inputs)) {
        problems.push(`${subBlock.id}: sub-block has no declared block input ${publishedId}`)
      }
      for (const operation of [
        ...referencedOperations(subBlock.condition),
        ...referencedOperations(subBlock.required),
      ]) {
        if (!NETSUITE_TOOL_IDS.includes(operation as (typeof NETSUITE_TOOL_IDS)[number])) {
          problems.push(`${subBlock.id}: references unknown operation ${operation}`)
        }
      }
      const visibleOperations = NETSUITE_TOOL_IDS.filter((operation) =>
        conditionIncludesOperation(subBlock.condition, operation)
      )
      if (!visibleOperations.length)
        problems.push(`${subBlock.id}: unreachable for every operation`)
      for (const operation of NETSUITE_TOOL_IDS.filter((candidate) =>
        requiredForOperation(subBlock.required, candidate)
      )) {
        if (!visibleOperations.includes(operation)) {
          problems.push(`${subBlock.id}: required for ${operation} but not visible`)
        }
      }
    }

    for (const operation of NETSUITE_TOOL_IDS) {
      const tool = NETSUITE_TOOLS_BY_ID.get(operation)
      if (!tool) {
        problems.push(`${operation}: exported tool is missing`)
        continue
      }

      for (const [param, config] of Object.entries(tool.params)) {
        if (typeof config.required !== 'boolean') problems.push(`${operation}.${param}: required`)
        if (!config.visibility) problems.push(`${operation}.${param}: visibility`)
        if (!config.description?.trim()) problems.push(`${operation}.${param}: description`)
        if (config.visibility === 'hidden') continue

        const members = subBlocksForParam(operation, param)
        if (!members.length) {
          problems.push(`${operation}.${param}: no visible block field`)
          continue
        }
        for (const member of members) {
          const input = NetSuiteBlock.inputs[blockInputId(member)]
          if (!input) {
            problems.push(`${operation}.${param}: missing block input ${blockInputId(member)}`)
          } else if (input.type !== config.type) {
            problems.push(
              `${operation}.${param}: block type ${input.type} does not match tool type ${config.type}`
            )
          }
        }
        if (
          config.required &&
          !members.some((member) => requiredForWholeOperation(member.required, operation))
        ) {
          problems.push(`${operation}.${param}: required tool param is not required on the block`)
        }
      }

      for (const subBlock of NetSuiteBlock.subBlocks) {
        if (
          subBlock.id === 'operation' ||
          !conditionIncludesOperation(subBlock.condition, operation)
        ) {
          continue
        }
        const param = toolParamId(operation, subBlock)
        const config = tool.params[param]
        if (!config) {
          problems.push(`${operation}: ${subBlock.id} is visible but ${tool.id} has no ${param}`)
        } else if (requiredForWholeOperation(subBlock.required, operation) && !config.required) {
          problems.push(`${operation}.${param}: block requires an optional tool param`)
        }
        if (
          requiredForOperation(subBlock.required, operation) &&
          subBlock.mode === 'advanced' &&
          !subBlock.canonicalParamId
        ) {
          problems.push(`${operation}.${subBlock.id}: required field is advanced-only`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('keeps operation outputs aligned between tools and the block', () => {
    const problems: string[] = []
    for (const operation of NETSUITE_TOOL_IDS) {
      const tool = NETSUITE_TOOLS_BY_ID.get(operation)
      if (!tool) continue
      for (const output of Object.keys(tool.outputs ?? {})) {
        const blockOutput = NetSuiteBlock.outputs[output]
        const toolOutput = tool.outputs?.[output]
        if (!blockOutput) {
          problems.push(`${operation}.${output}: tool output is missing from the block`)
        } else if (!conditionIncludesOperation(blockOutput.condition, operation)) {
          problems.push(`${operation}.${output}: tool output is hidden by the block`)
        } else if (blockOutput.type !== toolOutput?.type) {
          problems.push(
            `${operation}.${output}: block type ${blockOutput.type} does not match tool type ${toolOutput?.type}`
          )
        }
      }
      for (const [output, config] of Object.entries(NetSuiteBlock.outputs)) {
        if (
          conditionIncludesOperation(config.condition, operation) &&
          !(output in (tool.outputs ?? {}))
        ) {
          problems.push(`${operation}.${output}: block exposes an undeclared tool output`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('covers every operation on canvas and preserves required action targets', () => {
    const byOperation = NetSuiteBlock.canvasPresentation?.sentences?.byOperation
    if (!byOperation) throw new Error('NetSuite block must define operation canvas sentences')
    expect(Object.keys(byOperation)).toEqual([...NETSUITE_TOOL_IDS])

    const coreFields = (operation: keyof typeof byOperation) => {
      const sentence = byOperation[operation]
      if (!Array.isArray(sentence)) return []
      return sentence.flatMap((part) => {
        if (typeof part !== 'object' || !part.core || !part.field) return []
        const fields = Array.isArray(part.field) ? part.field : [part.field]
        return fields.map((field) => {
          const subBlock = NetSuiteBlock.subBlocks.find((candidate) => candidate.id === field)
          return subBlock?.canonicalParamId ?? field
        })
      })
    }

    const semanticTargets = {
      netsuite_get_subresource: ['subresourcePath', 'recordType', 'recordId'],
      netsuite_get_select_options: ['fields', 'recordType'],
      netsuite_attach_record: ['relatedType', 'relatedId', 'recordType', 'recordId'],
      netsuite_detach_record: ['relatedType', 'relatedId', 'recordType', 'recordId'],
      netsuite_execute_action: ['action', 'recordType', 'recordId'],
      netsuite_transform_record: ['recordType', 'recordId', 'targetRecordType'],
    } as const
    for (const [operation, fields] of Object.entries(semanticTargets)) {
      expect(coreFields(operation as keyof typeof byOperation), operation).toEqual(
        expect.arrayContaining(fields)
      )
    }
  })

  it('uses one reusable service-account credential across all tools', () => {
    const referenceTool = NETSUITE_TOOLS_BY_ID.get(NETSUITE_TOOL_IDS[0])
    if (!referenceTool) throw new Error('Missing reference NetSuite tool')
    expect(getSubBlock('credential')).toMatchObject({
      type: 'oauth-input',
      serviceId: 'netsuite',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
    })
    expect(getSubBlock('manualCredential')).toMatchObject({
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      required: true,
    })
    for (const [operation, tool] of NETSUITE_TOOLS_BY_ID) {
      expect(tool.params.oauthCredential, `${operation}.oauthCredential`).toEqual(
        referenceTool.params.oauthCredential
      )
      expect(tool.params.accessToken, `${operation}.accessToken`).toEqual(
        referenceTool.params.accessToken
      )
      expect(tool.params.instanceUrl, `${operation}.instanceUrl`).toEqual(
        referenceTool.params.instanceUrl
      )
      for (const removed of ['suiteTalkUrl', 'clientId', 'certificateId', 'privateKey']) {
        expect(tool.params, `${operation}.${removed}`).not.toHaveProperty(removed)
      }
    }
    expect(NetSuiteBlock.inputs).toMatchObject({ oauthCredential: { type: 'string' } })
    for (const removed of ['suiteTalkUrl', 'clientId', 'certificateId', 'privateKey']) {
      expect(NetSuiteBlock.inputs).not.toHaveProperty(removed)
      expect(NetSuiteBlock.subBlocks.map((subBlock) => subBlock.id)).not.toContain(removed)
    }
  })

  it('keeps every selector paired with an advanced manual input', () => {
    const expectedGroups = {
      oauthCredential: ['credential', 'manualCredential'],
      recordType: ['recordTypeSelector', 'recordTypeManual'],
      datasetId: ['datasetSelector', 'datasetIdManual'],
      statusTaskId: ['statusTaskSelector', 'statusTaskIdManual'],
      resultTaskId: ['resultTaskSelector', 'resultTaskIdManual'],
    }
    for (const [canonicalParamId, ids] of Object.entries(expectedGroups)) {
      const members = NetSuiteBlock.subBlocks.filter(
        (subBlock) => subBlock.canonicalParamId === canonicalParamId
      )
      expect(
        members.map((member) => member.id),
        canonicalParamId
      ).toEqual(ids)
      expect(members.map((member) => member.mode)).toEqual(['basic', 'advanced'])
      expect(new Set(members.map((member) => JSON.stringify(member.condition ?? null))).size).toBe(
        1
      )
      expect(new Set(members.map((member) => JSON.stringify(member.required ?? null))).size).toBe(1)
    }
    expect(getSubBlock('recordTypeSelector')).toMatchObject({
      selectorKey: 'netsuite.recordTypes',
      dependsOn: ['credential'],
    })
    expect(getSubBlock('datasetSelector')).toMatchObject({
      selectorKey: 'netsuite.datasets',
      dependsOn: ['credential'],
    })
    for (const id of ['statusTaskSelector', 'resultTaskSelector']) {
      expect(getSubBlock(id)).toMatchObject({
        selectorKey: 'netsuite.asyncTasks',
        dependsOn: ['credential', 'jobId'],
      })
    }
  })

  it('keeps account-specific JSON dynamic and nested conditions explicit', () => {
    const body = getSubBlock('body')
    expect(body).toMatchObject({ type: 'code', language: 'json' })
    expect(getSubBlock('items')).toMatchObject({ type: 'code', language: 'json' })
    for (const field of ['roleId', 'roleExternalId']) {
      expect(getSubBlock(field).condition).toEqual({
        field: 'operation',
        value: 'netsuite_attach_record',
        and: { field: 'relatedType', value: 'contact' },
      })
    }
    expect(getSubBlock('statusTaskSelector')).toMatchObject({
      required: {
        field: 'operation',
        value: 'netsuite_get_async_status',
        and: { field: 'view', value: 'task' },
      },
    })
    expect(getSubBlock('resultTaskSelector')).toMatchObject({
      required: {
        field: 'operation',
        value: 'netsuite_get_async_result',
      },
    })
  })

  it('uses the SQL-specific generator for SuiteQL', () => {
    expect(getSubBlock('query').wandConfig).toMatchObject({
      enabled: true,
      generationType: 'sql-query',
    })
  })

  it('coerces only parameters used by the selected operation and drops stale hidden values', () => {
    const mapParams = NetSuiteBlock.tools.config.params
    if (!mapParams) throw new Error('NetSuite block must map tool parameters')
    const credentials = { oauthCredential: 'credential-id' }
    const mappedList = mapParams({
      operation: 'netsuite_list_records',
      ...credentials,
      body: '{bad stale json',
      items: '[bad stale json',
      limit: '250',
      offset: '500',
      expandSubResources: 'false',
    })

    expect(mappedList).toMatchObject({
      ...credentials,
      body: undefined,
      items: undefined,
      limit: 250,
      offset: 500,
      expandSubResources: undefined,
    })
    expect(mappedList).not.toHaveProperty('operation')

    expect(
      mapParams({ operation: 'netsuite_create_record', body: '{"companyName":"Acme"}' })
    ).toMatchObject({ body: { companyName: 'Acme' }, items: undefined })
    expect(
      mapParams({ operation: 'netsuite_batch_update_records', items: '[{"id":"7"}]' })
    ).toMatchObject({ body: undefined, items: [{ id: '7' }] })
    expect(
      mapParams({ operation: 'netsuite_get_record', expandSubResources: 'false' })
    ).toMatchObject({ expandSubResources: false })
    expect(
      mapParams({ operation: 'netsuite_get_async_status', statusTaskId: 'task-7' })
    ).toMatchObject({ taskId: 'task-7' })
    expect(
      mapParams({ operation: 'netsuite_get_async_result', resultTaskId: 'task-8' })
    ).toMatchObject({ taskId: 'task-8' })
    expect(
      mapParams({
        operation: 'netsuite_get_async_result',
        statusTaskId: 'stale-status-task',
        resultTaskId: 'current-result-task',
      })
    ).toMatchObject({ taskId: 'current-result-task' })
    expect(
      mapParams({
        operation: 'netsuite_get_async_status',
        statusTaskId: 'current-status-task',
        resultTaskId: 'stale-result-task',
      })
    ).toMatchObject({ taskId: 'current-status-task' })
    expect(mapParams({ operation: 'netsuite_get_async_result', resultTaskId: '' })).toMatchObject({
      taskId: '',
    })
    expect(mapParams({ operation: 'netsuite_get_async_status', statusTaskId: null })).toMatchObject(
      { taskId: null }
    )
    expect(
      mapParams({
        operation: 'netsuite_attach_record',
        relatedType: 'file',
        roleId: '-10',
        roleExternalId: 'family',
      })
    ).toMatchObject({ roleId: undefined, roleExternalId: undefined })
    expect(() => mapParams({ operation: 'netsuite_create_record', body: '{bad json' })).toThrow(
      'Record fields must be valid JSON'
    )
    for (const value of [true, false, [5], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => mapParams({ operation: 'netsuite_list_records', limit: value }),
        String(value)
      ).toThrow('Invalid number for Limit')
    }
    expect(
      mapParams({ operation: 'netsuite_list_records', limit: '   ', offset: null })
    ).toMatchObject({ limit: undefined, offset: undefined })
  })

  it('keeps async aliases, defaults, and conditional outputs explicit', () => {
    expect(NetSuiteBlock.outputs.location.condition).toEqual({
      field: 'operation',
      value: [
        'netsuite_create_record',
        'netsuite_update_record',
        'netsuite_batch_get_records',
        'netsuite_batch_create_records',
        'netsuite_batch_update_records',
        'netsuite_batch_upsert_records',
        'netsuite_batch_delete_records',
      ],
    })
    expect(NetSuiteBlock.outputs.jobId.condition).toEqual({
      field: 'operation',
      value: [
        'netsuite_batch_get_records',
        'netsuite_batch_create_records',
        'netsuite_batch_update_records',
        'netsuite_batch_upsert_records',
        'netsuite_batch_delete_records',
      ],
    })
    expect(getSubBlock('statusTaskSelector')).toHaveProperty('canonicalParamId', 'statusTaskId')
    expect(getSubBlock('resultTaskSelector')).toHaveProperty('canonicalParamId', 'resultTaskId')
    expect(getSubBlock('view')).toMatchObject({
      type: 'dropdown',
      condition: { field: 'operation', value: 'netsuite_get_async_status' },
    })
    expect(getSubBlock('view').value?.({})).toBe('job')
    expect(getSubBlock('replace')).not.toHaveProperty('wandConfig')
  })
})
