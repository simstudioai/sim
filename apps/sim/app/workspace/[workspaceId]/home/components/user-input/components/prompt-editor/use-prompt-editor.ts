import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAvailableResources } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown'
import { snapSelectionToChips } from '@/app/workspace/[workspaceId]/home/components/user-input/chip-selection'
import {
  chipDisplayToken,
  chipLinkToContext,
  parseChipLinks,
  serializeSelectionForClipboard,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/chip-clipboard-codec'
import {
  mapResourceToContext,
  type PlusMenuHandle,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { SkillsMenuHandle } from '@/app/workspace/[workspaceId]/home/components/user-input/components/skills-menu-dropdown/skills-menu-dropdown'
import { useSkillAutoMention } from '@/app/workspace/[workspaceId]/home/components/user-input/hooks/use-skill-auto-mention'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'
import {
  useContextManagement,
  useIntegrationAutoMention,
  useMentionMenu,
  useMentionTokens,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks'
import {
  restoreSkillTriggerText,
  SKILL_CHIP_TRIGGER,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/utils'
import { type SkillDefinition, useSkills } from '@/hooks/queries/skills'
import type { ChatContext } from '@/stores/panel'

/**
 * Computes the viewport position of a caret offset inside a textarea by
 * mirroring its text into a hidden, identically-styled div and measuring a
 * zero-width marker appended at the caret. Used to anchor the floating
 * mention / skills menus at the trigger character.
 */
function getCaretAnchor(
  textarea: HTMLTextAreaElement,
  caretPos: number
): { left: number; top: number } {
  const textareaRect = textarea.getBoundingClientRect()
  const style = window.getComputedStyle(textarea)

  const mirror = document.createElement('div')
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'break-word'
  mirror.style.font = style.font
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.width = style.width
  mirror.style.lineHeight = style.lineHeight
  mirror.style.boxSizing = style.boxSizing
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.textTransform = style.textTransform
  mirror.style.textIndent = style.textIndent
  mirror.style.textAlign = style.textAlign
  mirror.textContent = textarea.value.substring(0, caretPos)

  const marker = document.createElement('span')
  marker.style.display = 'inline-block'
  marker.style.width = '0px'
  marker.style.padding = '0'
  marker.style.border = '0'
  marker.style.verticalAlign = 'text-top'
  mirror.appendChild(marker)

  document.body.appendChild(mirror)
  const markerRect = marker.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()
  document.body.removeChild(mirror)

  return {
    left: textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft,
    top: textareaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop,
  }
}

/**
 * Host-supplied keyboard policy threaded through {@link PromptEditor} into the
 * editor's keydown handler. The editor handles everything intrinsic to editing
 * (menu navigation, chip atomicity); these hooks let the host claim the two
 * keys whose meaning depends on where the editor lives.
 */
export interface PromptEditorKeyPolicy {
  /**
   * Enter without Shift (and not composing): the newline is suppressed and
   * this fires instead — after the open mention/skills menu has had its chance
   * to confirm a selection. Omit to keep native newline insertion.
   */
  onSubmit?: () => void
  /**
   * Plain ArrowUp while the editor text is empty. Return `true` when handled
   * to consume the event (e.g. chat recalls the queued tail message); return
   * `false` to fall through to native caret movement.
   */
  onArrowUpOnEmpty?: () => boolean
}

export interface UsePromptEditorProps {
  /** Workspace whose resources, integrations, and skills the editor mentions. */
  workspaceId: string
  /** Initial text. Chipified (`@`-mentions / `/`-skills converted) on mount. */
  initialValue?: string
  /**
   * Contexts to seed the editor with — restored resource mentions (files,
   * tables, knowledge) that cannot be recovered from the prompt text alone.
   * Seed these rather than calling `setContexts` after mount: the mount
   * chipify pass MERGES integration `@`-mentions and `/`-skills on top, so a
   * post-mount `setContexts` would clobber those auto-registered contexts.
   */
  initialContexts?: ChatContext[]
  /**
   * Notified when a context is added through an interactive path — a mention
   * pick, a resource drop, or a skill pick. Paste re-registration is
   * intentionally silent so pasting never auto-opens host side panels.
   */
  onContextAdd?: (context: ChatContext) => void
  /**
   * Receives files pasted from the clipboard. Omit to ignore pasted files
   * (the paste is then a no-op, matching native textarea behavior).
   */
  onPasteFiles?: (files: FileList) => void
}

/** The editor instance returned by {@link usePromptEditor}. */
export type PromptEditorInstance = ReturnType<typeof usePromptEditor>

/**
 * Headless core of the prompt editor — the chat user-input's editing brain,
 * reusable anywhere a "type to Sim" surface is needed (the chat input, the
 * prompt modal body).
 *
 * Owns the text value, the mention contexts, and every editing behavior:
 * `@`-mention and `/`-skill detection with caret-anchored autocomplete menus,
 * integration/skill auto-chipification, atomic chip selection/deletion, and
 * the portable chip clipboard codec. Render it with {@link PromptEditor};
 * read `value` / `contexts` reactively and drive it through `setValue`,
 * `clear`, `insertResources`, `focusAtEnd`, etc.
 *
 * @example
 * ```tsx
 * const editor = usePromptEditor({ workspaceId })
 * const create = () => save(editor.getPlainValue(), editor.contexts)
 * return <PromptEditor editor={editor} placeholder='Describe the task...' onSubmit={create} />
 * ```
 */
export function usePromptEditor({
  workspaceId,
  initialValue = '',
  initialContexts,
  onContextAdd,
  onPasteFiles,
}: UsePromptEditorProps) {
  const { data: skills = [] } = useSkills(workspaceId)

  const [value, setValueState] = useState(initialValue)
  const valueRef = useRef(value)
  valueRef.current = value

  /**
   * Commits a new text value, keeping {@link valueRef} in lockstep with state so
   * synchronous readers (`getValue` / `getPlainValue`) never observe pre-edit
   * text. Use this for setters handed to child hooks, which cannot touch the ref.
   */
  const commitValue = useCallback((next: string) => {
    valueRef.current = next
    setValueState(next)
  }, [])

  const plusMenuRef = useRef<PlusMenuHandle>(null)
  const skillsMenuRef = useRef<SkillsMenuHandle>(null)
  const atInsertPosRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const mentionRangeRef = useRef<{ start: number; end: number } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const slashRangeRef = useRef<{ start: number; end: number } | null>(null)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)

  /**
   * Start offset of a mention/slash token the user just dismissed via outside
   * click or Escape. A dismiss alone doesn't move the caret, so the very next
   * `selectionchange`/click still lands inside the still-open token range and
   * would otherwise reopen the menu it was just closed — the "can't click
   * away" bug. Suppresses exactly one reopen per token; cleared the moment
   * the user types again (`handleInputChange`) so editing the token still
   * works normally.
   */
  const dismissedMentionStartRef = useRef<number | null>(null)
  const dismissedSlashStartRef = useRef<number | null>(null)

  const contextManagement = useContextManagement({ message: value, initialContexts })
  const contextManagementRef = useRef(contextManagement)
  contextManagementRef.current = contextManagement

  const onContextAddRef = useRef(onContextAdd)
  onContextAddRef.current = onContextAdd
  const onPasteFilesRef = useRef(onPasteFiles)
  onPasteFilesRef.current = onPasteFiles

  const addContextNotified = useCallback((context: ChatContext) => {
    contextManagementRef.current.addContext(context)
    onContextAddRef.current?.(context)
  }, [])

  const mentionMenu = useMentionMenu({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    onContextSelect: addContextNotified,
    onMessageChange: commitValue,
  })

  const textareaRef = mentionMenu.textareaRef

  const mentionTokens = useMentionTokens({
    message: value,
    selectedContexts: contextManagement.selectedContexts,
    mentionMenu,
    setMessage: commitValue,
  })

  const integrationAutoMention = useIntegrationAutoMention({
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  const skillAutoMention = useSkillAutoMention({
    skills,
    setSelectedContexts: contextManagement.setSelectedContexts,
  })

  /**
   * Bulk-chipifies a block of text on the non-keystroke paths (mount,
   * template, draft restore, STT, queued message, multi-char paste): explicit
   * integration `@`-mentions first (casing canonicalized; bare names are never
   * touched), then skill `/` triggers (swapped to the sentinel). Returns the
   * fully converted text and registers both context kinds.
   */
  const applyAutoMentions = useCallback(
    (text: string) => skillAutoMention.applyToText(integrationAutoMention.applyToText(text)),
    [skillAutoMention.applyToText, integrationAutoMention.applyToText]
  )
  const applyAutoMentionsRef = useRef(applyAutoMentions)
  applyAutoMentionsRef.current = applyAutoMentions

  /**
   * Tracks the seeded `initialValue` through chipify passes. While the text is
   * still the untouched seed, the canonicalization effect below may re-run; a
   * user edit (or a programmatic `setValue`) invalidates the seed and ends the
   * passes, so a re-pass can never rewrite user edits.
   */
  const seedRef = useRef<string | null>(initialValue || null)

  /**
   * Canonicalize integration `@`-mentions and skill `/` triggers for any
   * seeded `initialValue`. The skill matcher is built from a React Query
   * result, so on a cold cache the mount pass runs before skills resolve —
   * the effect re-runs once when the skill list first fills and re-chipifies
   * the still-untouched seed. Mid-typing conversion is intentionally NOT
   * handled here — the keystroke fast-path in `handleInputChange` covers that
   * case via `processChange`, and running it on every value change would
   * rewrite tokens while the user is still typing the name and prematurely
   * open the menu.
   */
  useEffect(() => {
    const seed = seedRef.current
    if (seed === null) return
    if (valueRef.current !== seed) {
      seedRef.current = null
      return
    }
    const converted = applyAutoMentions(seed)
    if (converted !== seed) {
      valueRef.current = converted
      setValueState(converted)
    }
    seedRef.current = skills.length > 0 ? null : converted
  }, [skills.length, applyAutoMentions])

  const existingResourceKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const ctx of contextManagement.selectedContexts) {
      if (ctx.kind === 'workflow' && ctx.workflowId) keys.add(`workflow:${ctx.workflowId}`)
      if (ctx.kind === 'knowledge' && ctx.knowledgeId) keys.add(`knowledgebase:${ctx.knowledgeId}`)
      if (ctx.kind === 'table' && ctx.tableId) keys.add(`table:${ctx.tableId}`)
      if (ctx.kind === 'file' && ctx.fileId) keys.add(`file:${ctx.fileId}`)
      if (ctx.kind === 'folder' && ctx.folderId) keys.add(`folder:${ctx.folderId}`)
      if (ctx.kind === 'past_chat' && ctx.chatId) keys.add(`task:${ctx.chatId}`)
    }
    return keys
  }, [contextManagement.selectedContexts])

  const availableResources = useAvailableResources(workspaceId, existingResourceKeys)

  /**
   * Programmatically replaces the editor text. Chipifies by default so any
   * seeded prose (template, transcript, queued message) registers its
   * integration / skill chips; pass `{ chipify: false }` for verbatim text.
   */
  const setValue = useCallback((text: string, options?: { chipify?: boolean }) => {
    const next = options?.chipify === false ? text : applyAutoMentionsRef.current(text)
    valueRef.current = next
    setValueState(next)
  }, [])

  /** The user-visible text as of the last edit, fresher than `value` mid-event. */
  const getValue = useCallback(() => valueRef.current, [])

  /**
   * The outgoing form of the text: skill chips store an EM SPACE sentinel in
   * place of `/` so the centered icon fits its overlay slot — this restores
   * the literal `/` so the text reads as clean `/skill-name`. Use this, never
   * raw `value`, when submitting or persisting the prompt.
   */
  const getPlainValue = useCallback(() => restoreSkillTriggerText(valueRef.current), [])

  const focusAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      const end = textarea.value.length
      textarea.setSelectionRange(end, end)
    })
  }, [textareaRef])

  /**
   * Resets the editor to its pristine state: empties the text, drops all
   * contexts, closes both menus (programmatic close() bypasses Radix's
   * onOpenChange, so the menu onClose callbacks won't fire — mention state is
   * cleared inline so ArrowUp etc. aren't intercepted afterwards), and resets
   * the grown textarea height.
   */
  const clear = useCallback(() => {
    valueRef.current = ''
    setValueState('')
    contextManagementRef.current.clearContexts()
    plusMenuRef.current?.close()
    mentionRangeRef.current = null
    setMentionQuery(null)
    dismissedMentionStartRef.current = null
    skillsMenuRef.current?.close()
    slashRangeRef.current = null
    setSlashQuery(null)
    dismissedSlashStartRef.current = null
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [textareaRef])

  const insertResource = useCallback(
    (resource: MothershipResource) => {
      const textarea = textareaRef.current
      if (textarea) {
        const currentValue = valueRef.current
        const range = mentionRangeRef.current
        let before: string
        let after: string
        let insertText: string
        let newPos: number

        if (range) {
          before = currentValue.slice(0, range.start)
          after = currentValue.slice(range.end)
          const needsSpaceBefore =
            range.start > 0 && !/\s/.test(currentValue.charAt(range.start - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
          newPos = before.length + insertText.length
        } else {
          const insertAt = atInsertPosRef.current ?? textarea.selectionStart ?? currentValue.length
          const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}@${resource.title} `
          before = currentValue.slice(0, insertAt)
          after = currentValue.slice(insertAt)
          newPos = before.length + insertText.length
        }

        const newValue = `${before}${insertText}${after}`
        pendingCursorRef.current = newPos
        valueRef.current = newValue
        atInsertPosRef.current = newPos
        mentionRangeRef.current = null
        setMentionQuery(null)
        dismissedMentionStartRef.current = null
        setValueState(newValue)
      }

      const context = mapResourceToContext(resource)
      addContextNotified(context)
    },
    [textareaRef, addContextNotified]
  )

  /**
   * Inserts a batch of resources as `@title` chips (drag-drop path), then
   * resets the insert anchor so the next non-drop insert uses the cursor.
   */
  const insertResources = useCallback(
    (resources: MothershipResource[]) => {
      for (const resource of resources) {
        insertResource(resource)
      }
      atInsertPosRef.current = null
    },
    [insertResource]
  )

  const handleSkillSelect = useCallback(
    (skill: SkillDefinition) => {
      const textarea = textareaRef.current
      if (textarea) {
        const currentValue = valueRef.current
        const range = slashRangeRef.current
        let before: string
        let after: string
        let insertText: string
        let newPos: number

        if (range) {
          before = currentValue.slice(0, range.start)
          after = currentValue.slice(range.end)
          const needsSpaceBefore =
            range.start > 0 && !/\s/.test(currentValue.charAt(range.start - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}${SKILL_CHIP_TRIGGER}${skill.name} `
          newPos = before.length + insertText.length
        } else {
          const insertAt = textarea.selectionStart ?? currentValue.length
          const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
          insertText = `${needsSpaceBefore ? ' ' : ''}${SKILL_CHIP_TRIGGER}${skill.name} `
          before = currentValue.slice(0, insertAt)
          after = currentValue.slice(insertAt)
          newPos = before.length + insertText.length
        }

        const newValue = `${before}${insertText}${after}`
        pendingCursorRef.current = newPos
        valueRef.current = newValue
        slashRangeRef.current = null
        setSlashQuery(null)
        dismissedSlashStartRef.current = null
        setValueState(newValue)
      }

      addContextNotified({ kind: 'skill', skillId: skill.id, label: skill.name })
    },
    [textareaRef, addContextNotified]
  )

  const handleSkillsMenuClose = useCallback(() => {
    // See `handlePlusMenuClose` — only reachable via a real Radix dismiss.
    dismissedSlashStartRef.current = slashRangeRef.current?.start ?? null
    slashRangeRef.current = null
    setSlashQuery(null)
  }, [])

  const handlePlusMenuClose = useCallback(() => {
    // Only reachable via Radix's own dismiss detection (outside click / Escape) —
    // programmatic closes (`plusMenuRef.current?.close()`) bypass `onOpenChange`
    // and never call this. Remember the token so the caret's own selection-change
    // handler (fired by the same click) doesn't immediately reopen it.
    dismissedMentionStartRef.current = mentionRangeRef.current?.start ?? null
    atInsertPosRef.current = null
    mentionRangeRef.current = null
    setMentionQuery(null)
  }, [])

  const getActiveMentionAtRef = useRef(mentionMenu.getActiveMentionQueryAtPosition)
  getActiveMentionAtRef.current = mentionMenu.getActiveMentionQueryAtPosition

  const getActiveSlashAtRef = useRef(mentionMenu.getActiveSlashQueryAtPosition)
  getActiveSlashAtRef.current = mentionMenu.getActiveSlashQueryAtPosition

  const syncMentionState = useCallback(
    (textarea: HTMLTextAreaElement, text: string, caret: number) => {
      const active = getActiveMentionAtRef.current(caret, text)
      // Any word-boundary character inside the query — whitespace, sentence
      // punctuation, or brackets — dismisses the menu. The mention token
      // is "complete" the moment the user types a non-word character, so
      // there's nothing more to query. Mirrors the boundary set the
      // integration auto-detector uses for symmetry.
      const isOpenable = active && !/[\s.,;:!?(){}[\]"'`/\\<>]/.test(active.query)
      if (!isOpenable) {
        if (mentionRangeRef.current !== null) {
          mentionRangeRef.current = null
          setMentionQuery(null)
          plusMenuRef.current?.close()
        }
        dismissedMentionStartRef.current = null
        return
      }

      // The user just dismissed the menu for this exact token (outside click /
      // Escape) and hasn't typed since — a caret move alone must not reopen it.
      if (active.start === dismissedMentionStartRef.current) {
        if (mentionRangeRef.current !== null) {
          mentionRangeRef.current = null
          setMentionQuery(null)
        }
        return
      }

      const wasActive = mentionRangeRef.current !== null
      mentionRangeRef.current = { start: active.start, end: active.end }
      setMentionQuery(active.query)
      if (!wasActive) {
        // Anchor at the caret so the menu floats above the user's cursor.
        const anchor = getCaretAnchor(textarea, active.start)
        plusMenuRef.current?.open(anchor, { mention: true })
      }
    },
    []
  )

  const syncSlashState = useCallback(
    (textarea: HTMLTextAreaElement, text: string, caret: number) => {
      const active = getActiveSlashAtRef.current(caret, text)
      // Any word-boundary character inside the query dismisses the menu. The
      // boundary set intentionally excludes `/` so the slash itself doesn't
      // self-dismiss the menu it just opened.
      const isOpenable = active && !/[\s.,;:!?(){}[\]"'`\\<>]/.test(active.query)
      if (!isOpenable) {
        if (slashRangeRef.current !== null) {
          slashRangeRef.current = null
          setSlashQuery(null)
          skillsMenuRef.current?.close()
        }
        dismissedSlashStartRef.current = null
        return
      }

      // See the mirrored check in `syncMentionState`.
      if (active.start === dismissedSlashStartRef.current) {
        if (slashRangeRef.current !== null) {
          slashRangeRef.current = null
          setSlashQuery(null)
        }
        return
      }

      const wasActive = slashRangeRef.current !== null
      slashRangeRef.current = { start: active.start, end: active.end }
      setSlashQuery(active.query)
      if (!wasActive) {
        // Anchor at the caret so the menu floats above the user's cursor.
        const anchor = getCaretAnchor(textarea, active.start)
        skillsMenuRef.current?.open(anchor)
      }
    },
    []
  )

  /**
   * Inserts a `/` at the caret (with a leading space when needed so the slash
   * starts a token) and opens the skills menu — the toolbar Slash button flow.
   */
  const insertSlashTrigger = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()

    const currentValue = valueRef.current
    const insertAt = textarea.selectionStart ?? currentValue.length
    // A `/` only triggers the menu when it starts a token (at start or after
    // whitespace). Insert a leading space when the preceding char isn't one.
    const needsSpaceBefore = insertAt > 0 && !/\s/.test(currentValue.charAt(insertAt - 1))
    const insertText = `${needsSpaceBefore ? ' ' : ''}/`
    const before = currentValue.slice(0, insertAt)
    const after = currentValue.slice(insertAt)
    const newValue = `${before}${insertText}${after}`
    const newCaret = before.length + insertText.length

    valueRef.current = newValue
    setValueState(newValue)
    textarea.value = newValue
    textarea.setSelectionRange(newCaret, newCaret)
    syncSlashState(textarea, newValue, newCaret)
  }, [textareaRef, syncSlashState])

  /**
   * Opens the resource browse menu (non-mention mode) anchored at the given
   * viewport position — the toolbar `+` button flow.
   */
  const openResourceMenu = useCallback((anchor: { left: number; top: number }) => {
    plusMenuRef.current?.open(anchor)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const previousValue = valueRef.current
      const nextValue = e.target.value

      let finalValue = nextValue
      if (nextValue.length === previousValue.length + 1) {
        // Single-char keystroke — synchronous, boundary-triggered.
        finalValue = integrationAutoMention.processChange({
          textarea: e.target,
          previousValue,
          nextValue,
        })
        // Run skills on the post-integration value so a completed `/name` token
        // chips. A confirmed skill rewrites its leading `/` to the wide sentinel
        // (in the textarea and in the returned value) so the centered icon fits.
        finalValue = skillAutoMention.processChange({
          textarea: e.target,
          previousValue,
          nextValue: finalValue,
        })
      } else if (nextValue.length > previousValue.length + 1) {
        // Multi-char insertion (paste, drag-drop, IME commit) — bulk convert all
        // matches and rewrite the textarea via `setRangeText` to keep the edit
        // in a single native undo step.
        finalValue = applyAutoMentions(nextValue)
        if (finalValue !== nextValue) {
          const caretBefore = e.target.selectionStart ?? nextValue.length
          e.target.setRangeText(finalValue, 0, nextValue.length, 'preserve')
          // Replacing the whole value leaves the selection spanning the replaced
          // range (it would select all the text). Collapse the caret to its
          // converted position: only insertions BEFORE the caret should shift
          // it, so measure the converted length of just the leading slice (a
          // converted name after the caret must not move it). The re-registered
          // contexts dedupe in `mergeContexts`, so this is side-effect-safe.
          const caretAfter = applyAutoMentions(nextValue.slice(0, caretBefore)).length
          e.target.setSelectionRange(caretAfter, caretAfter)
        }
      }

      const caret = e.target.selectionStart ?? finalValue.length
      valueRef.current = finalValue
      setValueState(finalValue)
      // A keystroke is an active edit — always let it reopen a just-dismissed
      // menu, even for the same token the user clicked away from.
      dismissedMentionStartRef.current = null
      dismissedSlashStartRef.current = null
      syncMentionState(e.target, finalValue, caret)
      syncSlashState(e.target, finalValue, caret)
    },
    [
      applyAutoMentions,
      integrationAutoMention.processChange,
      skillAutoMention.processChange,
      syncMentionState,
      syncSlashState,
    ]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, policy?: PromptEditorKeyPolicy) => {
      if (mentionRangeRef.current && !e.nativeEvent.isComposing) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          plusMenuRef.current?.moveActive(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          plusMenuRef.current?.moveActive(-1)
          return
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
          // Confirm the highlighted match if there is one. If no items match, fall
          // through so Enter still submits and Tab still does its default thing.
          if (plusMenuRef.current?.selectActive()) {
            e.preventDefault()
            return
          }
        }
      }

      if (slashRangeRef.current && !e.nativeEvent.isComposing) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          skillsMenuRef.current?.moveActive(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          skillsMenuRef.current?.moveActive(-1)
          return
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
          // Confirm the highlighted skill if there is one. If no items match, fall
          // through so Enter still submits and Tab still does its default thing.
          if (skillsMenuRef.current?.selectActive()) {
            e.preventDefault()
            return
          }
        }
      }

      if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (valueRef.current.length === 0 && policy?.onArrowUpOnEmpty?.()) {
          e.preventDefault()
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && policy?.onSubmit) {
        e.preventDefault()
        policy.onSubmit()
        return
      }

      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      // Single-chip delete: remove the token's text atomically. A selection
      // delete falls through to the native edit; either way the context-sync
      // effect prunes contexts whose last token is gone. Cmd+Backspace
      // (delete to line start) stays native — it spans more than one chip.
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectionLength === 0 && !e.metaKey) {
        const ranges = mentionTokens.mentionRanges
        const target =
          e.key === 'Backspace'
            ? ranges.find((r) => selStart > r.start && selStart <= r.end)
            : ranges.find((r) => selStart >= r.start && selStart < r.end)

        if (target) {
          e.preventDefault()
          mentionTokens.deleteRange(target)
          return
        }
      }

      // Hop chips on plain arrows only: Shift/Cmd/Alt/Ctrl variants and IME
      // composition keep native handling; the select handler snaps any
      // resulting edge inside a chip to a chip boundary.
      if (
        selectionLength === 0 &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.nativeEvent.isComposing
      ) {
        if (textarea) {
          if (e.key === 'ArrowLeft') {
            const nextPos = Math.max(0, selStart - 1)
            const r = mentionTokens.findRangeContaining(nextPos)
            if (r) {
              e.preventDefault()
              const target = r.start
              setTimeout(() => textarea.setSelectionRange(target, target), 0)
              return
            }
          } else if (e.key === 'ArrowRight') {
            const nextPos = Math.min(valueRef.current.length, selStart + 1)
            const r = mentionTokens.findRangeContaining(nextPos)
            if (r) {
              e.preventDefault()
              const target = r.end
              setTimeout(() => textarea.setSelectionRange(target, target), 0)
              return
            }
          }
        }
      }

      // Block typing inside a chip (snap to its end instead). Cmd/Ctrl
      // shortcuts (Cmd+A, Cmd+C, ...) don't insert text and must pass through.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        const blocked = selectionLength === 0 && !!mentionTokens.findRangeContaining(selStart)
        if (blocked) {
          e.preventDefault()
          const r = mentionTokens.findRangeContaining(selStart)
          if (r && textarea) {
            setTimeout(() => {
              textarea.setSelectionRange(r.end, r.end)
            }, 0)
          }
          return
        }
      }
    },
    [mentionTokens, textareaRef]
  )

  /**
   * Adopts the textarea's DOM value into state. State and DOM can only drift
   * when an edit's input event is lost (programmatic edits pair setValueState
   * synchronously) — the DOM is the user's intent.
   */
  const adoptDomValue = useCallback((textarea: HTMLTextAreaElement) => {
    valueRef.current = textarea.value
    setValueState(textarea.value)
  }, [])

  // Selection one change ago, used to infer which edge of a range moved. Kept
  // current by the `selectionchange` listener below — which fires on EVERY
  // caret/selection change (typing, arrows, clicks, programmatic), unlike
  // `select`/`mouseup` — so the inference is never fed a stale `prev`.
  const prevSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    let last = { start: 0, end: 0 }
    const onSelectionChange = () => {
      if (document.activeElement !== textarea) return
      prevSelectionRef.current = last
      last = { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0 }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [textareaRef])

  /**
   * Keeps mention chips atomic under every selection gesture. A collapsed
   * caret inside a chip snaps to the nearest edge; a ranged selection edge
   * inside a chip snaps to a chip boundary — never collapsed — so select-all,
   * Shift+arrows, drag, and double-click all select chips whole.
   */
  const handleSelectAdjust = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart ?? 0
    const end = textarea.selectionEnd ?? 0
    const prev = prevSelectionRef.current

    // Adopt value changes that bypassed React's change tracking (browser
    // autofill, password managers, grammar extensions — see facebook/react#2125)
    // so state never drifts from the DOM. Skip when state is empty: submit clears
    // the value synchronously, but a select/mouseUp can fire while the textarea
    // still holds the just-sent text, and adopting it would resurrect the message.
    if (valueRef.current !== '' && textarea.value !== valueRef.current) {
      adoptDomValue(textarea)
      return
    }

    const startChip = mentionTokens.findRangeContaining(start)
    const endChip = start === end ? startChip : mentionTokens.findRangeContaining(end)
    const snapped = snapSelectionToChips({ start, end }, prev, startChip, endChip)

    if (snapped.start !== start || snapped.end !== end) {
      // Deferred so in-flight click/drag processing can't override the write,
      // and bailed if the selection moved again first. The write re-fires this
      // handler, which then syncs the menus.
      setTimeout(() => {
        if (textarea.selectionStart !== start || textarea.selectionEnd !== end) return
        textarea.setSelectionRange(
          snapped.start,
          snapped.end,
          textarea.selectionDirection ?? undefined
        )
      }, 0)
      return
    }

    const focusPos = textarea.selectionDirection === 'backward' ? start : end
    syncMentionState(textarea, textarea.value, focusPos)
    syncSlashState(textarea, textarea.value, focusPos)
  }, [textareaRef, mentionTokens, adoptDomValue, syncMentionState, syncSlashState])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget

    // Portable chip links (`[label](sim:kind/id)`) re-create their chip on
    // paste-back. Rewrite each link span to its `@label ` token (the trailing
    // space is REQUIRED so useContextManagement's sync effect doesn't purge the
    // freshly-added context) and register the contexts directly.
    const pastedText = e.clipboardData?.getData('text/plain') ?? ''
    const links = parseChipLinks(pastedText)
    if (links.length > 0) {
      e.preventDefault()

      const pastedContexts: ChatContext[] = []
      let rewritten = ''
      let cursor = 0
      for (let i = 0; i < links.length; i++) {
        const link = links[i]
        let between = pastedText.slice(cursor, link.start)
        // Self-heal: a run of plain spaces sitting ENTIRELY between two chips is
        // glue the codec re-emits, so collapse it to one space — gaps accumulated
        // by earlier pastes clean themselves up. Newlines and prose-bordering
        // whitespace contain non-space chars and are left verbatim.
        if (i > 0 && /^ +$/.test(between)) between = ' '
        rewritten += between
        const ctx = chipLinkToContext(link)
        pastedContexts.push(ctx)
        // Insert the kind-correct token (skill EM-SPACE sentinel, slash `/`, `@`
        // else) so the chip re-renders with its proper trigger glyph and the
        // context-sync effect (keyed on the same per-kind prefix) keeps it. Append
        // a single separator ONLY when the next source char is non-whitespace
        // (chip→chip / chip→word); existing whitespace and end-of-string already
        // supply the boundary, so re-pasting never accumulates spaces.
        const next = pastedText.charAt(link.end)
        rewritten += /\S/.test(next) ? `${chipDisplayToken(ctx)} ` : chipDisplayToken(ctx)
        cursor = link.end
      }
      rewritten += pastedText.slice(cursor)

      const selStart = textarea.selectionStart ?? valueRef.current.length
      const selEnd = textarea.selectionEnd ?? selStart
      const needsSpaceBefore =
        selStart > 0 &&
        !/\s/.test(valueRef.current.charAt(selStart - 1)) &&
        /^[@/\u2003]/.test(rewritten)
      const insert = needsSpaceBefore ? ` ${rewritten}` : rewritten

      textarea.setRangeText(insert, selStart, selEnd, 'end')
      const newValue = textarea.value
      const caret = selStart + insert.length

      // Use addContext directly — NOT the notified path — so pasting does NOT
      // auto-open host side panels (the notified path fires onContextAdd).
      for (const ctx of pastedContexts) contextManagementRef.current.addContext(ctx)

      valueRef.current = newValue
      setValueState(newValue)
      requestAnimationFrame(() => {
        textarea.setSelectionRange(caret, caret)
      })
      return
    }

    const items = e.clipboardData?.items
    if (!items) return

    const pastedFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) pastedFiles.push(file)
      }
    }

    if (pastedFiles.length === 0) return
    const acceptFiles = onPasteFilesRef.current
    if (!acceptFiles) return

    e.preventDefault()
    const dt = new DataTransfer()
    for (const file of pastedFiles) {
      dt.items.add(file)
    }
    acceptFiles(dt.files)
  }, [])

  /**
   * On copy/cut, write a portable representation of the selection to the
   * clipboard. Portable resource chips (table/file/folder/etc.) become
   * `[label](sim:kind/id)` markdown links so they read cleanly anywhere AND
   * re-create their chip when pasted back into the input. Skill chips (whose
   * EM SPACE sentinel maps back to `/`) and `@integration` tokens stay readable
   * text and round-trip by name. Returns true when it took over the clipboard
   * (the caller must then perform the cut deletion itself, since the default
   * was prevented).
   */
  const writeSanitizedClipboard = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): boolean => {
      const textarea = e.currentTarget
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? 0
      const selected = textarea.value.slice(start, end)
      if (!selected) return false
      const serialized = serializeSelectionForClipboard(
        selected,
        contextManagementRef.current.selectedContexts
      )
      if (serialized === selected) return false
      e.preventDefault()
      e.clipboardData.setData('text/plain', serialized)
      return true
    },
    []
  )

  const handleCopy = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      writeSanitizedClipboard(e)
    },
    [writeSanitizedClipboard]
  )

  const handleCut = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // When the selection holds a portable chip (skill or resource) we take over
      // the clipboard, so the selected text must be removed here (default prevented).
      // Either way the context-sync effect prunes contexts whose token is now gone.
      if (!writeSanitizedClipboard(e)) return
      const textarea = e.currentTarget
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? 0
      textarea.setRangeText('', start, end, 'end')
      valueRef.current = textarea.value
      setValueState(textarea.value)
    },
    [writeSanitizedClipboard]
  )

  return {
    /** Current text, reactive. Render-safe; for event handlers prefer `getValue()`. */
    value,
    /** Mention contexts currently registered in the text, reactive. */
    contexts: contextManagement.selectedContexts,
    /** Replaces the registered contexts (draft / queued-message restore). */
    setContexts: contextManagement.setSelectedContexts,
    setValue,
    getValue,
    getPlainValue,
    clear,
    focusAtEnd,
    insertResources,
    insertSlashTrigger,
    openResourceMenu,
    /** The editor's textarea element — focus management, caret restore. */
    textareaRef,

    /** @internal Wiring consumed by the {@link PromptEditor} view. */
    skills,
    /** @internal */
    availableResources,
    /** @internal */
    mentionQuery,
    /** @internal */
    slashQuery,
    /** @internal */
    plusMenuRef,
    /** @internal */
    skillsMenuRef,
    /** @internal */
    pendingCursorRef,
    /** @internal */
    insertResource,
    /** @internal */
    handleSkillSelect,
    /** @internal */
    handlePlusMenuClose,
    /** @internal */
    handleSkillsMenuClose,
    /** @internal */
    handleInputChange,
    /** @internal */
    handleKeyDown,
    /** @internal */
    handlePaste,
    /** @internal */
    handleCopy,
    /** @internal */
    handleCut,
    /** @internal */
    handleSelectAdjust,
  }
}
