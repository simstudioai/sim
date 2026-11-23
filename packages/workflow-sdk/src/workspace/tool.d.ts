/**
 * Custom tool declarations: `tools/<key>.ts`, with the tool's code beside it in `tools/<key>.js`.
 *
 * ```ts
 * // @sim-sdk 1
 * import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'
 *
 * export default defineTool({
 *   title: 'Lookup order',
 *   schema: {
 *     type: 'function',
 *     function: {
 *       name: 'lookup_order',
 *       description: 'Find an order by id.',
 *       parameters: {
 *         type: 'object',
 *         properties: { orderId: { type: 'string' } },
 *         required: ['orderId'],
 *       },
 *     },
 *   },
 *   code: codeFile('./lookup-order.js'),
 * })
 * ```
 *
 * The code file runs with each parameter as a variable; `$env.NAME` reads an environment variable
 * by name. The key is the tool's identity: a workflow names it as `customTool('lookup-order')`.
 * Code holding a literal credential prints as `code: stored()`, which keeps the code the server
 * holds without showing it.
 */
import type { CodeFileRef, Json } from '@sim/workflow-sdk'

export { codeFile, stored } from '@sim/workflow-sdk'

/** JSON as an object literal writes it: an optional member may be absent. */
type SchemaJson = Json | readonly SchemaJson[] | { readonly [key: string]: SchemaJson | undefined }

/** The function declaration a model calls the tool by, stored verbatim. */
export interface ToolSchema {
  type: 'function'
  function: {
    /** What the model calls: letters, digits, `_` and `-`, at most 64 characters. */
    name: string
    description?: string
    /** A JSON Schema object describing the arguments. */
    parameters: {
      type: 'object'
      properties: { [name: string]: Json }
      required?: string[]
      readonly [extra: string]: SchemaJson | undefined
    }
    readonly [extra: string]: SchemaJson | undefined
  }
  readonly [extra: string]: SchemaJson | undefined
}

/** A custom tool declaration. */
export interface ToolDeclaration {
  /** The tool's display title, unique in the workspace. */
  title: string
  schema: ToolSchema
  /** `codeFile('./<key>.js')`, the code inline as a string, or `stored()` to keep the stored code. */
  code: CodeFileRef | string
}

/** Declares a custom tool. Its default export is the whole file. */
export declare function defineTool(tool: ToolDeclaration): ToolDeclaration
