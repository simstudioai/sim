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

  it('decodes percent-encoded VFS path segments for display', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/My%20Report.txt',
      })?.text
    ).toBe('Reading My Report.txt')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'workflows/My%20Workflow/meta.json',
      })?.text
    ).toBe('Read My Workflow')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/caf%C3%A9.txt',
      })?.text
    ).toBe('Reading café.txt')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Quarterly%20Report.docx/content',
      })?.text
    ).toBe('Read Quarterly Report.docx')
  })

  it('shows only the file name for file reads, dropping the folder path and content qualifier', () => {
    // Bare file leaf inside a folder → just the file name (with extension).
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Skills/Skill%20%E2%80%94%20PostHog%20Analytics.md',
      })?.text
    ).toBe('Read Skill — PostHog Analytics.md')

    // Explicit content facet → no "the content of", folder dropped too.
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Skills/Skill%20%E2%80%94%20PostHog%20Analytics.md/content',
      })?.text
    ).toBe('Read Skill — PostHog Analytics.md')

    // Non-content facets keep their descriptive label but still show only the name.
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/Reports/brief.docx/meta.json',
      })?.text
    ).toBe('Reading metadata for brief.docx')
  })

  it('falls back to the raw segment when it is not valid percent-encoding', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.executing, {
        path: 'files/100%done.txt',
      })?.text
    ).toBe('Reading 100%done.txt')
  })

  it('formats special workspace file reads as natural language', () => {
    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.error, {
        path: 'files/haiku_collection_sim.pptx/compiled-check',
      })?.text
    ).toBe('Attempted to read the final file check for haiku_collection_sim.pptx')

    expect(
      resolveToolDisplay(ReadTool.id, ClientToolCallState.success, {
        path: 'files/Reports/brief.docx/content',
      })?.text
    ).toBe('Read brief.docx')

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
