/**
 * Workflow runs hand a tool `{ ...rawInputs, ...mappedParams }`, so the mapper must clear
 * values another operation left in a shared subBlock. Agent tool calls pass the operation in
 * context and supply arguments under tool param names, which the mapper must keep.
 */
import { describe, expect, it } from 'vitest'
import { MonacoBlock } from '@/blocks/blocks/monaco'
import { monacoCreateTagTool } from '@/tools/monaco/create_tag'
import { monacoCreateTaskTool } from '@/tools/monaco/create_task'
import { monacoUpdateSequenceTool } from '@/tools/monaco/update_sequence'
import type { ToolConfig } from '@/tools/types'

const CREDENTIAL = { oauthCredential: 'cred-1', accessToken: 'mks_test' }

function requestBody(tool: ToolConfig, params: Record<string, unknown>) {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no request body`)
  return body(params)
}

function workflowParams(inputs: Record<string, unknown>) {
  const mapped = MonacoBlock.tools.config?.params?.(inputs) ?? {}
  return { ...inputs, ...mapped, accessToken: CREDENTIAL.accessToken }
}

function agentParams(operation: string, args: Record<string, unknown>) {
  const inputs = { ...CREDENTIAL, ...args }
  const mapped = MonacoBlock.tools.config?.params?.(inputs, { operation }) ?? {}
  return { ...inputs, ...mapped, accessToken: CREDENTIAL.accessToken }
}

describe('Monaco block parameter mapping', () => {
  it('sends the task title, not a job title left in the contact Title field', () => {
    const params = workflowParams({
      ...CREDENTIAL,
      operation: 'monaco_create_task',
      title: 'VP Sales',
      taskTitle: 'Call Ada',
    })
    expect(requestBody(monacoCreateTaskTool, params)).toEqual({ title: 'Call Ada' })
  })

  it('drops a contact job title when the task title is empty', () => {
    const params = workflowParams({
      ...CREDENTIAL,
      operation: 'monaco_create_task',
      title: 'VP Sales',
      taskTitle: '',
    })
    expect(params.title).toBeUndefined()
  })

  it('keeps agent arguments named after tool params', () => {
    const tag = agentParams('monaco_create_tag', {
      object: 'accounts',
      name: 'Hot Lead',
      color: 'red',
    })
    expect(requestBody(monacoCreateTagTool, tag)).toEqual({
      object: 'accounts',
      name: 'Hot Lead',
      color: 'red',
    })

    const sequence = agentParams('monaco_update_sequence', {
      sequenceId: '0b2c7c1e-4d0a-4c8e-9a51-2f4f3e6a7b10',
      action: 'pause',
    })
    expect(requestBody(monacoUpdateSequenceTool, sequence)).toEqual({ action: 'pause' })
  })
})
