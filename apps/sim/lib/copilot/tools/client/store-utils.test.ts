/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { resolveToolDisplay } from './store-utils'
import { ClientToolCallState } from './tool-call-state'

describe('resolveToolDisplay', () => {
  it('uses a friendly label for internal respond tools', () => {
    expect(resolveToolDisplay('respond', ClientToolCallState.executing)?.text).toBe(
      'Gathering thoughts'
    )
    expect(resolveToolDisplay('workflow_respond', ClientToolCallState.success)?.text).toBe(
      'Gathering thoughts'
    )
  })

  it('formats read targets from workspace paths', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/report.pdf',
      })?.text
    ).toBe('Reading report.pdf')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/My Workflow/meta.json',
      })?.text
    ).toBe('Read My Workflow')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/Folder 1/RET XYZ/state.json',
      })?.text
    ).toBe('Read RET XYZ')
  })

  it('formats special workspace file reads as natural language', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.error, {
        path: 'files/haiku_collection_sim.pptx/compiled-check',
      })?.text
    ).toBe('Attempted to read the final file check for haiku_collection_sim.pptx')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/by-id/87c18b84-2f83-43a4-bed8-8a86f7d42022/compiled-check',
      })?.text
    ).toBe('Read the final file check for this file')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/by-id/625094cc-2f64-4de9-a39c-452cb8283bb1/content',
      })?.text
    ).toBe('Read the content of this file')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/report.pdf/meta.json',
      })?.text
    ).toBe('Reading metadata for report.pdf')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/deck.pptx/style',
      })?.text
    ).toBe('Read style details for deck.pptx')
  })

  it('falls back to a humanized tool label for generic tools', () => {
    expect(resolveToolDisplay('deploy_api', ClientToolCallState.success)?.text).toBe(
      'Executed Deploy Api'
    )
  })

  it('hides internal deferred tool loaders', () => {
    expect(resolveToolDisplay('load_custom_tool', ClientToolCallState.executing)).toBeUndefined()
  })
})
