/** Runs in Chrome's isolated world; all inputs are serialized by scripting.executeScript. */
export function extractPageText(
  kind: 'page' | 'selection',
  maxCharacters: number,
  maxBytes: number
) {
  const startedAt = performance.now()
  const source = new URL(location.href)
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) {
    throw new Error('This page cannot be attached.')
  }
  source.search = ''
  source.hash = ''
  if (kind === 'selection' && document.activeElement?.matches('iframe,frame'))
    throw new Error('Open the embedded page in its own tab to attach selected text.')
  const selection = kind === 'selection' ? window.getSelection() : null
  if (kind === 'selection' && (!selection || selection.isCollapsed || selection.rangeCount !== 1)) {
    throw new Error('Select text on the page, then choose Ask Sim from the context menu.')
  }
  const range = selection?.getRangeAt(0)
  const root = range?.commonAncestorContainer ?? document.body
  if (!root) throw new Error('This page has no readable text.')

  const excluded =
    'script,style,noscript,template,iframe,object,embed,canvas,svg,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-sim-extension-ignore]'
  const hidden = (node: Element) => {
    if (node.matches(excluded)) return true
    const style = getComputedStyle(node)
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0'
    )
  }
  let visited = 0
  let ancestor = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : root.parentElement
  while (ancestor) {
    if (performance.now() - startedAt > 150)
      throw new Error('Reading this page took too long. Select a smaller section.')
    if (++visited > 15_000)
      throw new Error(
        'This selection is too deeply nested to capture safely. Select a smaller section.'
      )
    if (hidden(ancestor)) throw new Error('This selection is inside an editable or hidden field.')
    ancestor = ancestor.parentElement
  }

  const pending: Node[] = [root]
  const parts: string[] = []
  const encoder = new TextEncoder()
  let characters = 0
  let bytes = 0
  let truncated = false
  while (pending.length) {
    if (++visited > 15_000 || performance.now() - startedAt > 150) {
      truncated = true
      break
    }
    const node = pending.pop()
    if (!node) break
    if (node !== root && node.nextSibling) pending.push(node.nextSibling)
    if (range && !range.intersectsNode(node)) continue
    if (node.nodeType === Node.ELEMENT_NODE && hidden(node as Element)) continue
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text
      const start = range && node === range.startContainer ? range.startOffset : 0
      const end = range && node === range.endContainer ? range.endOffset : textNode.length
      const count = Math.min(end - start, maxCharacters - characters)
      let text = textNode.substringData(start, count)
      if (count < end - start) truncated = true
      text = text
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      const remaining = maxCharacters - characters - 1
      if (remaining <= 0) {
        truncated = true
        break
      }
      if (text.length > remaining) {
        text = text.slice(0, remaining)
        truncated = true
      }
      while (text && bytes + encoder.encode(JSON.stringify(text)).byteLength > maxBytes - 10_000) {
        text = text.slice(0, Math.max(0, text.length - 1_000))
        truncated = true
      }
      if (!text) {
        truncated = true
        break
      }
      parts.push(text)
      characters += text.length + 1
      bytes += encoder.encode(JSON.stringify(text)).byteLength
      if (truncated) break
    } else if (node.firstChild) {
      pending.push(node.firstChild)
    }
  }
  const text = parts.join('\n')
  if (!text)
    throw new Error('No readable text was found. This page may use a document viewer or canvas.')
  return {
    url: source.href,
    title: document.title.slice(0, 512),
    text,
    capturedAt: new Date().toISOString(),
    kind,
    truncated,
  }
}
