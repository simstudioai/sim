'use client'

import { cn } from '@sim/emcn'
import { SCHEMA_PLACEHOLDER } from '@/app/workspace/[workspaceId]/components/custom-tool-editor/custom-tool-schema'
import type { useSchemaGeneration } from '@/app/workspace/[workspaceId]/components/custom-tool-editor/use-custom-tool-generation'
import { CodeEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tool-input/components/code-editor/code-editor'

interface CustomToolSchemaFieldProps {
  value: string
  onChange: (value: string) => void
  error: boolean
  generation: ReturnType<typeof useSchemaGeneration>
}

/**
 * The JSON-schema half of the custom tool editor. The surrounding surface owns
 * the section label, the "Generate" action, and the error message — this field
 * is just the editor, so both consumers can frame it however they need.
 */
export function CustomToolSchemaField({
  value,
  onChange,
  error,
  generation,
}: CustomToolSchemaFieldProps) {
  const busy = generation.isLoading || generation.isStreaming

  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      language='json'
      placeholder={SCHEMA_PLACEHOLDER}
      minHeight='420px'
      error={error}
      className={cn(busy && 'cursor-not-allowed opacity-50')}
      disabled={busy}
    />
  )
}
