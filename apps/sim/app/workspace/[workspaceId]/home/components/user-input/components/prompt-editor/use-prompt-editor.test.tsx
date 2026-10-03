/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { integrationMatcherMock } from '@sim/testing/mocks/integration-matcher.mock'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/skills', () => ({ useSkills: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/mcp', () => ({ useMcpToolServers: () => ({ data: [] }) }))
vi.mock('@/blocks/integration-matcher', () => integrationMatcherMock)

import { SIM_SELECTION_MIME } from '@/lib/mothership/chat/selection-clipboard'
import {
  type UsePromptEditorProps,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/prompt-editor/use-prompt-editor'
import { getIntegrationMatcher } from '@/blocks/integration-matcher'
import type { ChatContext } from '@/stores/panel'

function selectionPayload(context: ChatContext, sourceWorkspaceId = 'ws-1'): string {
  return JSON.stringify({ version: 1, sourceWorkspaceId, context })
}

/**
 * Mounts `usePromptEditor` in a real React 19 root under jsdom (no
 * `@testing-library/react` in this repo — see `hooks/queries/unsubscribe.test.tsx`
 * for the established pattern) and wires a real `<textarea>` into its
 * `textareaRef` so selection/caret-driven behavior (`handleSelectAdjust`,
 * `syncMentionState`) runs exactly as it does in the rendered `PromptEditor`.
 */
function renderPromptEditor(props: UsePromptEditorProps) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let latest: ReturnType<typeof usePromptEditor>

  function Probe() {
    latest = usePromptEditor(props)
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <>{children}</>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  const textarea = document.createElement('textarea')
  document.body.appendChild(textarea)
  latest!.textareaRef.current = textarea

  return {
    result: () => latest,
    textarea,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
      textarea.remove()
    },
  }
}

/** Fires a native `input` event carrying the new value, as the textarea would on a keystroke. */
function typeInto(textarea: HTMLTextAreaElement, value: string, caret = value.length) {
  textarea.value = value
  textarea.setSelectionRange(caret, caret)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe.each([{ workspaceId: 'ws-1' }, { workspaceId: '', organizationId: 'org-1' }])(
  'mention search in $workspaceId $organizationId',
  (scope) => {
    it.each([false, true])(
      'does not auto-attach an integration after searching (dismissed: %s)',
      (dismissed) => {
        const matcher = vi.mocked(getIntegrationMatcher)
        matcher.mockReturnValue({
          regex: /Slack/gi,
          byName: new Map([
            ['slack', { name: 'Slack', blockType: 'slack', icon: () => null, bgColor: '#fff' }],
          ]),
        })
        const { result, textarea, unmount } = renderPromptEditor(scope)
        try {
          for (const character of '@Slack') {
            act(() => {
              typeInto(textarea, textarea.value + character)
              result().handleInputChange({
                target: textarea,
              } as React.ChangeEvent<HTMLTextAreaElement>)
            })
          }
          if (dismissed) act(() => result().handlePlusMenuClose())
          for (const character of ' roadmap') {
            act(() => {
              typeInto(textarea, textarea.value + character)
              result().handleInputChange({
                target: textarea,
              } as React.ChangeEvent<HTMLTextAreaElement>)
            })
          }
          expect(result().getActiveContexts()).toEqual([])
          expect(result().mentionQuery).toBe(dismissed ? null : 'Slack roadmap')
        } finally {
          unmount()
          matcher.mockReset()
        }
      }
    )

    it('keeps multiword and punctuated names searchable and replaces the whole query', () => {
      const { result, textarea, unmount } = renderPromptEditor(scope)
      try {
        for (const value of [
          'Find @Quarterly',
          'Find @Quarterly ',
          'Find @Quarterly plan (v2).md',
        ]) {
          act(() => {
            typeInto(textarea, value)
            result().handleInputChange({
              target: textarea,
            } as React.ChangeEvent<HTMLTextAreaElement>)
          })
          expect(result().mentionQuery).toBe(value.slice('Find @'.length))
        }
        act(() =>
          result().insertResource({ type: 'file', id: 'plan', title: 'Quarterly plan (v2).md' })
        )
        expect(result().getPlainValue()).toBe('Find @Quarterly plan (v2).md ')
        expect(result().getActiveContexts()).toEqual([
          { kind: 'file', fileId: 'plan', label: 'Quarterly plan (v2).md' },
        ])
      } finally {
        unmount()
      }
    })

    it('keeps a dismissed search closed while typing, but allows a new trigger', () => {
      const { result, textarea, unmount } = renderPromptEditor(scope)
      const input = (value: string) => {
        act(() => {
          typeInto(textarea, value)
          result().handleInputChange({ target: textarea } as React.ChangeEvent<HTMLTextAreaElement>)
        })
      }
      try {
        input('@Quarterly')
        act(() => result().handlePlusMenuClose())
        input('@Quarterlyplan')
        expect(result().mentionQuery).toBeNull()
        input('@Quarterly plan')
        expect(result().mentionQuery).toBeNull()
        input('@Quarterly plan @Roadmap')
        expect(result().mentionQuery).toBe('Roadmap')
      } finally {
        unmount()
      }
    })

    it.each(['selection', 'programmatic'])(
      'opens a fresh search when replacing a dismissed trigger via %s',
      (replacement) => {
        const { result, textarea, unmount } = renderPromptEditor(scope)
        const input = (value: string) => {
          act(() => {
            typeInto(textarea, value)
            result().handleInputChange({
              target: textarea,
            } as React.ChangeEvent<HTMLTextAreaElement>)
          })
        }
        try {
          input('@Quarterly')
          act(() => result().handlePlusMenuClose())
          if (replacement === 'selection') {
            act(() => {
              textarea.setSelectionRange(0, textarea.value.length)
              result().handleSelectAdjust()
            })
            expect(result().mentionQuery).toBeNull()
            input('@Roadmap')
          } else {
            act(() => result().setValue('@Roadmap', { chipify: false }))
            act(() => {
              typeInto(textarea, result().getValue())
              result().handleSelectAdjust()
            })
          }
          expect(result().mentionQuery).toBe('Roadmap')
        } finally {
          unmount()
        }
      }
    )

    it.each(['@ ', '@ name', '@Quarterly\n', 'person@example.com'])(
      'does not search across a dismissed boundary in %j',
      (value) => {
        const { result, textarea, unmount } = renderPromptEditor(scope)
        try {
          act(() => {
            typeInto(textarea, value)
            result().handleInputChange({
              target: textarea,
            } as React.ChangeEvent<HTMLTextAreaElement>)
          })
          expect(result().mentionQuery).toBeNull()
        } finally {
          unmount()
        }
      }
    )
  }
)

describe('usePromptEditor context insertion', () => {
  it('leaves a cross-workspace selection to the ordinary plain-text paste path', () => {
    const context = {
      kind: 'file_selection',
      fileId: 'file-1',
      fileName: 'notes.md',
      label: 'notes.md:1',
      text: 'ordinary text',
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({ workspaceId: 'ws-2' })
    const preventDefault = vi.fn()

    act(() => {
      result().handlePaste({
        currentTarget: textarea,
        clipboardData: {
          getData: (type: string) => {
            if (type === 'text/plain') return context.text
            if (type === SIM_SELECTION_MIME) return selectionPayload(context)
            return ''
          },
        },
        preventDefault,
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(result().contexts).toEqual([])

    unmount()
  })

  it('excludes a deleted chip from submission before the cleanup effect runs', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const context = {
      kind: 'browser_tab',
      tabId: 'tab-1',
      label: 'Browser',
      selection: { text: 'selected text', url: 'https://example.com' },
    } satisfies ChatContext
    const { result, textarea, unmount } = renderPromptEditor({
      workspaceId: 'ws-1',
      initialValue: 'Explain this',
    })

    act(() => result().insertContext(context))

    let contextsAtSubmit: ChatContext[] = []
    act(() => {
      typeInto(textarea, 'Explain this')
      result().handleInputChange({
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
      contextsAtSubmit = result().getActiveContexts()
    })

    expect(contextsAtSubmit).toEqual([])
    unmount()
  })
})

it('addresses selected organization resources to their discovery workspace', () => {
  const { result, unmount } = renderPromptEditor({ workspaceId: 'ws-1', organizationId: 'org-1' })
  try {
    act(() => result().insertResource({ type: 'table', id: 'table-1', title: 'Accounts' }))
    expect(result().getActiveContexts()).toEqual([
      { kind: 'table', tableId: 'table-1', label: 'Accounts', workspaceId: 'ws-1' },
    ])
  } finally {
    unmount()
  }
})

it('preserves an explicit cross-workspace resource owner in the organization mention list', () => {
  const { result, unmount } = renderPromptEditor({ workspaceId: '', organizationId: 'org-1' })
  try {
    act(() =>
      result().insertResource({
        type: 'file',
        id: 'report.csv',
        title: 'Report · Finance',
        workspaceId: 'finance',
      })
    )
    expect(result().getActiveContexts()).toEqual([
      { kind: 'file', fileId: 'report.csv', label: 'Report · Finance', workspaceId: 'finance' },
    ])
  } finally {
    unmount()
  }
})

it('keeps a copied organization resource chip addressed to its owner workspace on paste', () => {
  const { result, textarea, unmount } = renderPromptEditor({
    workspaceId: '',
    organizationId: 'org-1',
  })
  try {
    act(() =>
      result().insertResource({
        type: 'table',
        id: 'table-1',
        title: 'Accounts',
        workspaceId: 'sales',
      })
    )
    textarea.value = result().value
    textarea.setSelectionRange(0, textarea.value.length)
    let copied = ''
    act(() => {
      result().handleCopy({
        currentTarget: textarea,
        clipboardData: {
          setData: (_type: string, value: string) => {
            copied = value
          },
        },
        preventDefault: () => {},
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })

    act(() => result().clear())
    textarea.value = ''
    textarea.setSelectionRange(0, 0)
    act(() => {
      result().handlePaste({
        currentTarget: textarea,
        clipboardData: { getData: (type: string) => (type === 'text/plain' ? copied : '') },
        preventDefault: () => {},
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })

    expect(result().contexts).toEqual([
      { kind: 'table', tableId: 'table-1', label: 'Accounts', workspaceId: 'sales' },
    ])
  } finally {
    unmount()
  }
})

it('pastes a chip link with a malformed owner as the plain text it is', () => {
  const { result, textarea, unmount } = renderPromptEditor({
    workspaceId: '',
    organizationId: 'org-1',
  })
  let nativePasteCancelled = false
  try {
    act(() => {
      result().handlePaste({
        currentTarget: textarea,
        clipboardData: {
          getData: (type: string) =>
            type === 'text/plain' ? '[Notes](sim:file/file-1?workspace=100%)' : '',
        },
        preventDefault: () => {
          nativePasteCancelled = true
        },
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>)
    })
    expect(nativePasteCancelled).toBe(false)
    expect(result().contexts).toEqual([])
  } finally {
    unmount()
  }
})

it('auto-registers unique organization skill names with their owner but leaves ambiguous names unresolved', () => {
  const skill = {
    id: 'built-in',
    workspaceId: 'sales',
    userId: null,
    name: 'Review',
    description: '',
    content: '',
    canEdit: false,
    createdAt: '',
    updatedAt: '',
  }
  const unique = renderPromptEditor({
    workspaceId: '',
    organizationId: 'org-1',
    initialValue: '/Review ',
    initialContexts: [{ kind: 'skill', skillId: skill.id, label: skill.name }],
    availableSkills: [skill],
  })
  try {
    expect(unique.result().getActiveContexts()).toEqual([
      { kind: 'skill', skillId: 'built-in', label: 'Review', workspaceId: 'sales' },
    ])
  } finally {
    unique.unmount()
  }
  const ambiguous = renderPromptEditor({
    workspaceId: '',
    organizationId: 'org-1',
    initialValue: '/Review ',
    availableSkills: [skill, { ...skill, workspaceId: 'finance' }],
  })
  try {
    expect(ambiguous.result().getActiveContexts()).toEqual([])
  } finally {
    ambiguous.unmount()
  }
})

it('inserts a canonical built-in skill globally without inheriting a workspace', () => {
  const skill = {
    id: 'builtin-research',
    workspaceId: null,
    userId: null,
    name: 'research',
    description: '',
    content: '',
    canEdit: false,
    readOnly: true,
    createdAt: '',
    updatedAt: '',
  }
  const { result, unmount } = renderPromptEditor({
    workspaceId: 'sales',
    organizationId: 'org-1',
    availableSkills: [skill],
  })
  try {
    act(() => result().handleSkillSelect(skill, 'finance'))
    expect(result().getActiveContexts()).toEqual([
      { kind: 'skill', skillId: 'builtin-research', label: 'research' },
    ])
  } finally {
    unmount()
  }
})
