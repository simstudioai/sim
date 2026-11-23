/**
 * Thrown by a block's `tools.config.params` mapper when a tool call must not run at all.
 *
 * A mapper failure on a tool call is normally logged and the tool runs with the raw merged
 * params instead (`prepareToolExecution`, Pi's local tools, Human-in-the-loop v2 notifications).
 * That fallback drops the canonical collapse along with everything else, so a model-supplied
 * argument the user's pinned value had hidden comes back: a Table bulk delete would run with the
 * model's `filter` rather than the filter the user configured. This error is rethrown instead,
 * and the call is reported as failed, so its message reaches the model unredacted and must
 * never quote an argument value.
 *
 * Deliberately a leaf module: blocks import it, and `@/blocks/utils` already imports
 * `@/providers/utils`.
 */
export class ToolCallParamsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ToolCallParamsError'
  }
}
