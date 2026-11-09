/**
 * What the custom tool editor reads, in Settings and in the tool input: the schema helpers, code and
 * schema generation, and the triggers and patterns its code field highlights. Named apart from the
 * tool input's seam so Settings never bundles the editor's block and tool lookups.
 */

export {
  CODE_PLACEHOLDER,
  extractSchemaParameters,
  FUNCTION_NAME_LOCKED,
  SCHEMA_PLACEHOLDER,
  type SchemaParameter,
  validateCustomToolSchema,
} from '@/components/custom-tool-editor/custom-tool-schema'
export {
  useCodeGeneration,
  useSchemaGeneration,
} from '@/components/custom-tool-editor/use-custom-tool-generation'
export {
  createEnvVarPattern,
  createWorkflowVariablePattern,
} from '@/executor/utils/reference-validation'
export { checkEnvVarTrigger } from '@/platform/lib/data/credentials/env-var-suggestions'
export { checkTagTrigger } from '@/platform/lib/data/workflow-editor/reference-triggers'
