/** @vitest-environment jsdom */

import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyPiiStages } from '@/lib/guardrails/pii-entities'
import { orgPolicyDraft, type PolicyDraft } from '@/ee/data-retention/lib/policy-draft'
import { PolicyDetail } from '@/platform/embedded/app/(shell)/settings/_components/sections/data-retention/policy-detail'

const BLANK_MESSAGE = 'Enter a regular expression, or remove this pattern'

function draftWithPattern(regex: string, stage: 'logs' | 'input'): PolicyDraft {
  const stages = emptyPiiStages()
  stages[stage] = {
    ...stages[stage],
    enabled: true,
    customPatterns: [{ name: 'Employee', regex, replacement: 'EMPLOYEE' }],
  }
  return orgPolicyDraft({
    logDays: '30',
    softDeleteDays: '30',
    taskCleanupDays: '30',
    defaultPii: { id: 'rule', stages },
    piiOverrides: [],
    overrides: [],
  })
}

describe('PolicyDetail custom patterns', () => {
  let container: HTMLDivElement
  let root: Root
  const onSave = vi.fn()

  const saveButton = () =>
    Array.from(container.querySelectorAll('button')).find((node) => node.textContent === 'Save')
  const render = (draft: PolicyDraft) =>
    act(async () => {
      root.render(
        <PolicyDetail
          draft={draft}
          isNew={false}
          changed
          isSaving={false}
          canRemove={false}
          workspaceOptions={[]}
          onChange={() => {}}
          onBack={() => {}}
          onDiscard={() => {}}
          onSave={onSave}
          onRemove={async () => {}}
        />
      )
    })

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    stubResizeObserver()
    container = window.document.createElement('div')
    window.document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('blocks saving a blank pattern and names it on its row', async () => {
    await render(draftWithPattern('', 'logs'))

    expect(saveButton()?.disabled).toBe(true)
    expect(container.textContent).toContain(BLANK_MESSAGE)
  })

  it('blocks saving a pattern that does not compile', async () => {
    await render(draftWithPattern('(unclosed', 'logs'))

    expect(saveButton()?.disabled).toBe(true)
  })

  it('blocks saving a bad pattern in a stage that is not on screen', async () => {
    const draft = draftWithPattern('', 'input')
    draft.piiStages.logs = {
      ...draft.piiStages.logs,
      enabled: true,
      entityTypes: ['EMAIL_ADDRESS'],
    }
    await render(draft)

    expect(container.textContent).not.toContain(BLANK_MESSAGE)
    expect(saveButton()?.disabled).toBe(true)
  })

  it('allows saving valid patterns', async () => {
    await render(draftWithPattern('EMP-\\d+', 'logs'))

    expect(saveButton()?.disabled).toBe(false)
  })
})
