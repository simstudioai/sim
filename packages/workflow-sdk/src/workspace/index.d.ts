/**
 * The workspace declaration SDK: `import { … } from '@sim/workflow-sdk/workspace'` in the
 * declaration files of a workspace source directory (`tables/<key>.ts`, …). Like the workflow
 * SDK, nothing here runs: the server reads each file statically.
 */
export * from './credentials'
export * from './deployment'
export * from './file'
export * from './knowledge'
export * from './mcp'
export * from './secrets'
export * from './skill'
export * from './table'
export * from './tool'
