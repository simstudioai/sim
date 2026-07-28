import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Awareness } from 'y-protocols/awareness'

/**
 * Remote-collaborator caret presence for the file editor: the name label's
 * show-then-fade behavior and the edge-aware flip, plus the ProseMirror plugin
 * that drives them off awareness activity.
 *
 * Matches Google Docs: the name flag shows only while the peer has typed in the last
 * few seconds or on local hover, then hides after inactivity, leaving just the caret.
 */

/**
 * How long a peer's name label stays visible after their last activity (cursor
 * move / edit) before it fades, leaving just the colored caret bar.
 */
export const CARET_LABEL_HOLD_MS = 2000

/** Fallback caret color when a peer's awareness carries no `color`. */
export const DEFAULT_CARET_COLOR = '#000000'

/**
 * The active-state class {@link activateCaretLabel} toggles on the caret node to reveal the
 * name label; CSS transitions it back to hidden when removed. (yCursorPlugin reuses the DOM
 * node and never re-runs `render`, which is why this file drives the class itself.)
 */
const CARET_ACTIVE_CLASS = 'collaboration-carets__caret--active'

/** The class that flips the label to the caret's left near the editor's right edge. */
const CARET_FLIP_CLASS = 'collaboration-carets__caret--flip'

/** Per-caret fade timers, keyed by the (reused) caret DOM node. */
const caretFadeTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/**
 * Show a peer's name label, (re)start its fade timer, and flip it to the caret's
 * left when it would run off the editor's right edge.
 *
 * yCursorPlugin renders each caret as a keyed widget decoration, so ProseMirror
 * REUSES the same DOM node as the caret moves (verified: the render function is
 * not re-invoked on a position change) — a CSS animation therefore cannot restart
 * on activity. Instead the activity signal is the awareness `change` event, which
 * (unlike `update`) fires only on a real state change, not the 15s heartbeat, so
 * an idle peer's label correctly stays hidden.
 */
export function activateCaretLabel(caret: HTMLElement, editorRight?: number) {
  caret.classList.add(CARET_ACTIVE_CLASS)
  const existing = caretFadeTimers.get(caret)
  if (existing) clearTimeout(existing)
  caretFadeTimers.set(
    caret,
    setTimeout(() => {
      caret.classList.remove(CARET_ACTIVE_CLASS)
      caretFadeTimers.delete(caret)
    }, CARET_LABEL_HOLD_MS)
  )

  if (editorRight === undefined) return
  const label = caret.querySelector<HTMLElement>('.collaboration-carets__label')
  if (!label) return
  // Measure the default (rightward) position, then flip left only if it overflows.
  caret.classList.remove(CARET_FLIP_CLASS)
  if (label.getBoundingClientRect().right > editorRight) {
    caret.classList.add(CARET_FLIP_CLASS)
  }
}

/**
 * Builds a remote peer's caret DOM: a colored bar plus a name label tagged with
 * the peer's Yjs client id (so {@link createCaretActivityExtension} can find and
 * re-activate the reused node on later awareness changes). Shown immediately on
 * (re)appearance; the fade timer hides it after inactivity. Passed to
 * CollaborationCaret as its `render` option, which only supplies `user` — so the
 * client id rides along in the awareness `user` payload (each client stamps its own
 * `doc.clientID`; see `use-file-doc-collaboration.ts`).
 */
export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === 'string' ? user.color : DEFAULT_CARET_COLOR
  const name = typeof user.name === 'string' && user.name ? user.name : 'Collaborator'
  const clientId = typeof user.clientId === 'number' ? user.clientId : undefined
  const caret = document.createElement('span')
  caret.className = 'collaboration-carets__caret'
  // One inline var drives the caret bar, the dormant cap, and the name tag (all in CSS).
  caret.style.setProperty('--caret-color', color)
  if (clientId !== undefined) caret.dataset.caretClientId = String(clientId)
  const label = document.createElement('div')
  label.className = 'collaboration-carets__label'
  label.textContent = name
  caret.appendChild(label)
  activateCaretLabel(caret)
  return caret
}

/**
 * Drives the caret name-label show-then-fade off awareness activity. Because the
 * caret DOM node is reused across moves (see {@link activateCaretLabel}), the
 * `render` function alone can't reveal the label when a peer moves — this listens
 * for awareness `change` events and re-activates the matching caret node. Deferred
 * to the next frame so the node exists and is laid out (for the edge-flip measure).
 */
export function createCaretActivityExtension(awareness: Awareness): Extension {
  return Extension.create({
    name: 'collaborationCaretActivity',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('collaborationCaretActivity'),
          view: (editorView) => {
            // Coalesce bursts of awareness changes into a single rAF per frame, however many
            // peers moved: accumulate the changed client ids, then re-activate each matching
            // (reused) caret node once. The shared editorRight is read once up front; each moving
            // caret then does one getBoundingClientRect for its edge-flip measure (bounded by the
            // small number of concurrently-moving peers, not the awareness event rate).
            let raf = 0
            const pending = new Set<number>()
            const flush = () => {
              raf = 0
              const editorRight = editorView.dom.getBoundingClientRect().right
              for (const id of pending) {
                const caret = editorView.dom.querySelector<HTMLElement>(
                  `.collaboration-carets__caret[data-caret-client-id="${id}"]`
                )
                if (caret) activateCaretLabel(caret, editorRight)
              }
              pending.clear()
            }
            const onChange = ({ added, updated }: { added: number[]; updated: number[] }) => {
              for (const id of added) pending.add(id)
              for (const id of updated) pending.add(id)
              if (pending.size > 0 && !raf) raf = requestAnimationFrame(flush)
            }
            awareness.on('change', onChange)
            return {
              destroy: () => {
                awareness.off('change', onChange)
                if (raf) cancelAnimationFrame(raf)
              },
            }
          },
        }),
      ]
    },
  })
}
