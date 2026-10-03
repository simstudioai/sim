import { type Editor, InputRule, inputRulesPlugin, isExtensionRulesEnabled } from '@tiptap/core'

/**
 * Materializes the actual text-input event before converting its syntax. Native rule ranges may
 * extend past the current document for multi-character input; the native plugin still owns undo
 * and composition, whose text is already in the document.
 */
export function createTextInputRulePlugins(editor: Editor, name: string, rule: InputRule) {
  const extension = editor.extensionManager.extensions.find((item) => item.name === name)
  if (!extension || !isExtensionRulesEnabled(extension, editor.options.enableInputRules)) return []

  let pendingInput: { from: number; to: number; text: string } | null = null
  const plugin = inputRulesPlugin({
    editor,
    rules: [
      new InputRule({
        find: rule.find,
        undoable: rule.undoable,
        handler: (props) => {
          if (!pendingInput) return rule.handler(props)
          const { from, to, text } = pendingInput
          props.state.tr.insertText(text, from, to)
          return rule.handler({
            ...props,
            range: { from: props.range.from, to: from + text.length },
          })
        },
      }),
    ],
  })
  const handleTextInput = plugin.props.handleTextInput
  plugin.props.handleTextInput = (view, from, to, text, defaultTr) => {
    pendingInput = { from, to, text }
    try {
      return handleTextInput?.call(plugin, view, from, to, text, defaultTr)
    } finally {
      pendingInput = null
    }
  }
  return [plugin]
}
