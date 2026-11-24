/**
 * The runtime entry of `@sim/workflow-sdk`. A workflow file is compiled statically and never
 * runs, so every export here throws `SimSdkNotExecutable`. It lists only the core names, so a
 * tool that does run a workflow file resolves those imports; an ES module cannot export the
 * generated block builders (`agent`, `slack`, ...) without naming each, so importing one fails
 * with "export not found" instead. The types come from `core.d.ts` and the generated block
 * declarations.
 */

import { stub } from './not-executable'

export { SimSdkNotExecutable } from './not-executable'

export const t = stub('t')
export const js = stub('js')
export const py = stub('py')
export const sh = stub('sh')
export const json = stub('json')
export const md = stub('md')
export const ref = stub('ref')
export const raw = stub('raw')
export const todo = stub('todo')
export const stored = stub('stored')
export const codeFile = stub('codeFile')
export const env = stub('env')
export const credential = stub('credential')
export const table = stub('table')
export const knowledgeBase = stub('knowledgeBase')
export const skill = stub('skill')
export const folder = stub('folder')
export const file = stub('file')
export const customTool = stub('customTool')
export const mcp = stub('mcp')
export const edge = stub('edge')
export const block = stub('block')
export const workflow = stub('workflow')
export const childWorkflow = stub('childWorkflow')
export const loop = stub('loop')
export const parallel = stub('parallel')
export const condition = stub('condition')
export const router = stub('router')
export const fn = stub('fn')
export const runWorkflow = stub('runWorkflow')
export const human = stub('human')
export const response = stub('response')
export const setVariables = stub('setVariables')
export const note = stub('note')
export const trigger = stub('trigger')
export const legacy = stub('legacy')
export const vars = stub('vars')
