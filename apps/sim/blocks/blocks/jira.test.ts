/**
 * @vitest-environment node
 *
 * Schema gating for the Jira block's resource selectors.
 *
 * The expectations are derived from the tool contracts rather than hand-copied
 * operation lists, so adding an operation that consumes a project fails here
 * until the block's `condition` is widened to match.
 */
import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import { JiraBlock } from '@/blocks/blocks/jira'
import type { SubBlockConfig } from '@/blocks/types'
import {
  jiraAddAttachmentTool,
  jiraAddCommentTool,
  jiraAddWatcherTool,
  jiraAddWorklogTool,
  jiraAssignIssueTool,
  jiraBulkRetrieveTool,
  jiraCreateIssueLinkTool,
  jiraDeleteAttachmentTool,
  jiraDeleteCommentTool,
  jiraDeleteIssueLinkTool,
  jiraDeleteIssueTool,
  jiraDeleteWorklogTool,
  jiraGetAttachmentsTool,
  jiraGetCommentsTool,
  jiraGetFieldsTool,
  jiraGetProjectTool,
  jiraGetTransitionsTool,
  jiraGetUsersTool,
  jiraGetWorklogsTool,
  jiraListIssueTypesTool,
  jiraListProjectsTool,
  jiraRemoveWatcherTool,
  jiraRetrieveTool,
  jiraSearchIssuesTool,
  jiraSearchUsersTool,
  jiraTransitionIssueTool,
  jiraUpdateCommentTool,
  jiraUpdateTool,
  jiraUpdateWorklogTool,
  jiraWriteTool,
} from '@/tools/jira'
import type { ToolConfig } from '@/tools/types'

/**
 * The block's tools, keyed by id. Imported directly rather than through
 * `@/tools/registry`, which `vitest.setup.ts` mocks to `{}` for import cost.
 * Going through the registry would make every contract assertion below pass
 * vacuously.
 */
const TOOLS_BY_ID = new Map<string, ToolConfig>(
  (
    [
      jiraAddAttachmentTool,
      jiraAddCommentTool,
      jiraAddWatcherTool,
      jiraAddWorklogTool,
      jiraAssignIssueTool,
      jiraBulkRetrieveTool,
      jiraCreateIssueLinkTool,
      jiraDeleteAttachmentTool,
      jiraDeleteCommentTool,
      jiraDeleteIssueLinkTool,
      jiraDeleteIssueTool,
      jiraDeleteWorklogTool,
      jiraGetAttachmentsTool,
      jiraGetCommentsTool,
      jiraGetFieldsTool,
      jiraGetProjectTool,
      jiraGetTransitionsTool,
      jiraGetUsersTool,
      jiraGetWorklogsTool,
      jiraListIssueTypesTool,
      jiraListProjectsTool,
      jiraRemoveWatcherTool,
      jiraRetrieveTool,
      jiraSearchIssuesTool,
      jiraSearchUsersTool,
      jiraTransitionIssueTool,
      jiraUpdateCommentTool,
      jiraUpdateTool,
      jiraUpdateWorklogTool,
      jiraWriteTool,
    ] as ToolConfig[]
  ).map((tool) => [tool.id, tool])
)

/**
 * Operations where the project selector has no role: the endpoint takes no
 * project (issue/user search, site-wide lookups, issue links, attachment
 * delete) and no visible subblock depends on it.
 */
const PROJECT_HIDDEN_OPERATIONS = [
  'search',
  'search_users',
  'get_users',
  'list_projects',
  'get_fields',
  'create_link',
  'delete_link',
  'delete_attachment',
  'list_issue_types',
] as const

const operationSubBlock = JiraBlock.subBlocks.find((sb) => sb.id === 'operation')
const operationIds = (operationSubBlock?.options as Array<{ id: string }>).map((o) => o.id)

const subBlockById = (id: string): SubBlockConfig => {
  const found = JiraBlock.subBlocks.find((sb) => sb.id === id)
  if (!found) throw new Error(`Jira block has no subblock "${id}"`)
  return found
}

/** Whether a subblock renders for `operation`, using the app's own evaluator. */
const isVisibleFor = (sb: SubBlockConfig, operation: string): boolean =>
  evaluateSubBlockCondition(sb.condition, { operation })

/** Whether a subblock is marked required for `operation`. */
const isRequiredFor = (sb: SubBlockConfig, operation: string): boolean => {
  if (typeof sb.required === 'boolean') return sb.required
  if (!sb.required) return false
  return evaluateSubBlockCondition(sb.required, { operation })
}

/** The tool an operation dispatches to, via the block's own switch. */
const toolIdFor = (operation: string): string =>
  (JiraBlock.tools.config?.tool as (params: Record<string, string>) => string)({ operation })

/** Whether that tool declares `paramId` as a required input. */
const toolRequiresParam = (operation: string, paramId: string): boolean => {
  const toolId = toolIdFor(operation)
  const tool = TOOLS_BY_ID.get(toolId)
  if (!tool) throw new Error(`No imported tool for "${toolId}" (operation "${operation}")`)
  return Boolean(tool.params?.[paramId]?.required)
}

const PROJECT_MEMBERS = ['projectId', 'manualProjectId'] as const
const ISSUE_MEMBERS = ['issueKey', 'manualIssueKey'] as const

describe('Jira block operation gating', () => {
  it('exposes every operation exactly once', () => {
    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(operationIds).toContain('read')
    expect(operationIds).toContain('read-bulk')
  })

  it('resolves every operation to an imported tool', () => {
    // Guards the contract assertions below from passing vacuously: if an
    // operation dispatches to a tool this file does not import, fail loudly
    // rather than treat its params as absent.
    const unresolved = operationIds.filter((operation) => !TOOLS_BY_ID.has(toolIdFor(operation)))
    expect(unresolved).toEqual([])
  })

  describe('project selector matches the tool contract', () => {
    it.each(operationIds)(
      'shows the project selector for %s whenever its tool requires projectId',
      (operation) => {
        if (!toolRequiresParam(operation, 'projectId')) return
        for (const id of PROJECT_MEMBERS) {
          expect(isVisibleFor(subBlockById(id), operation)).toBe(true)
        }
      }
    )

    it.each(PROJECT_HIDDEN_OPERATIONS)('hides the project selector for %s', (operation) => {
      expect(toolRequiresParam(operation, 'projectId')).toBe(false)
      for (const id of PROJECT_MEMBERS) {
        expect(isVisibleFor(subBlockById(id), operation)).toBe(false)
      }
    })

    it('keeps the project selector on read-bulk, whose tool requires it', () => {
      expect(toolRequiresParam('read-bulk', 'projectId')).toBe(true)
      for (const id of PROJECT_MEMBERS) {
        expect(isVisibleFor(subBlockById(id), 'read-bulk')).toBe(true)
        expect(isRequiredFor(subBlockById(id), 'read-bulk')).toBe(true)
      }
    })

    it('keeps the project selector wherever the issue picker depends on it', () => {
      for (const operation of operationIds) {
        const issuePickerVisible = isVisibleFor(subBlockById('issueKey'), operation)
        if (!issuePickerVisible) continue
        expect(subBlockById('issueKey').dependsOn).toContain('projectId')
        expect(isVisibleFor(subBlockById('projectId'), operation)).toBe(true)
      }
    })
  })

  describe('condition is a superset of required', () => {
    it.each([...PROJECT_MEMBERS, ...ISSUE_MEMBERS])(
      '%s is visible on every operation where it is required',
      (id) => {
        const sb = subBlockById(id)
        for (const operation of operationIds) {
          if (!isRequiredFor(sb, operation)) continue
          expect(isVisibleFor(sb, operation)).toBe(true)
        }
      }
    )
  })

  describe('basic and advanced twins agree', () => {
    it.each([PROJECT_MEMBERS, ISSUE_MEMBERS])('%s render identically', (basicId, advancedId) => {
      const basic = subBlockById(basicId)
      const advanced = subBlockById(advancedId)
      expect(basic.canonicalParamId).toBe(advanced.canonicalParamId)
      expect(advanced.dependsOn).toEqual(basic.dependsOn)
      for (const operation of operationIds) {
        expect(isVisibleFor(advanced, operation)).toBe(isVisibleFor(basic, operation))
        expect(isRequiredFor(advanced, operation)).toBe(isRequiredFor(basic, operation))
      }
    })
  })

  describe('no visible subblock depends on a hidden one', () => {
    it.each(operationIds)('%s leaves every rendered dependency satisfiable', (operation) => {
      const visible = JiraBlock.subBlocks.filter((sb) => isVisibleFor(sb, operation))
      const visibleIds = new Set(visible.map((sb) => sb.id))
      for (const sb of visible) {
        const deps = Array.isArray(sb.dependsOn) ? sb.dependsOn : []
        for (const dep of deps) {
          // A dependency satisfied by a canonical twin counts as present.
          const depConfigs = JiraBlock.subBlocks.filter(
            (candidate) => candidate.id === dep || candidate.canonicalParamId === dep
          )
          const anyVisible = depConfigs.some((candidate) => visibleIds.has(candidate.id))
          expect(
            anyVisible,
            `"${sb.id}" renders for "${operation}" but its dependency "${dep}" does not`
          ).toBe(true)
        }
      }
    })
  })

  describe('operation labels', () => {
    const labelFor = (id: string) =>
      (operationSubBlock?.options as Array<{ id: string; label: string }>).find((o) => o.id === id)
        ?.label

    it('uses the Get convention for retrieval operations', () => {
      expect(labelFor('read')).toBe('Get Issue')
      expect(labelFor('read-bulk')).toBe('Get Bulk Issues')
    })

    it('leaves the persisted operation ids untouched', () => {
      expect(operationIds).toContain('read')
      expect(operationIds).toContain('read-bulk')
      expect(toolIdFor('read')).toBe('jira_retrieve')
      expect(toolIdFor('read-bulk')).toBe('jira_bulk_read')
    })
  })
})
