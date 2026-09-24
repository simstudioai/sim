/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getToolDisplayTitle,
  refineStreamingCliToolName,
} from '@/lib/mothership/tools/tool-display'

describe('refineStreamingCliToolName', () => {
  it('names the command from a partial prefix, skipping --output json', () => {
    expect(refineStreamingCliToolName('{"args":["--output","json","workflows","list"')).toBe(
      'cli_workflows_list'
    )
  })

  it('stays generic on an intermediate prefix, then resolves the full command', () => {
    const partial = '{"args":["workflows","operations"'
    const fuller = '{"args":["workflows","operations","apply","wf-1","--operations","[{'
    expect(refineStreamingCliToolName(partial)).toBeNull()
    expect(refineStreamingCliToolName(fuller)).toBe('cli_workflows_operations_apply')
  })

  it('never matches on a half-streamed token', () => {
    expect(refineStreamingCliToolName('{"args":["workflows","li')).toBeNull()
  })

  it('names agent augmentations', () => {
    expect(refineStreamingCliToolName('{"args":["workflow","trace","abc-123"')).toBe(
      'cli_workflow_trace'
    )
    expect(refineStreamingCliToolName('{"args":["workflow","deps"')).toBe('cli_workflow_deps')
  })

  it('returns null before the args array or on unknown commands', () => {
    expect(refineStreamingCliToolName('{"ar')).toBeNull()
    expect(refineStreamingCliToolName('{"args":["frobnicate","things"')).toBeNull()
  })

  it('recognizes --help wherever it appears', () => {
    expect(refineStreamingCliToolName('{"args":["tables","--help"')).toBe('cli_help')
  })
})

describe('cli display integration', () => {
  it('maps the new augmentation names to titles', () => {
    expect(getToolDisplayTitle('cli_workflow_trace', {})).toBe('Analyzing run trace')
    expect(getToolDisplayTitle('cli_workflow_deps', {})).toBe('Tracing block inputs')
    expect(getToolDisplayTitle('remember', {})).toBe('Updating memory')
    expect(getToolDisplayTitle('web_search', { query: 'latest sim release' })).toContain(
      'latest sim release'
    )
    expect(getToolDisplayTitle('task', { title: 'Inventory workspace' })).toBe(
      'Delegating: Inventory workspace'
    )
  })
})
