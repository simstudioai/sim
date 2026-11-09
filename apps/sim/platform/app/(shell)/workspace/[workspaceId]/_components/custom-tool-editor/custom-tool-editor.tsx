'use client'

import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/code-field'
import { highlightSyntax } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-editor.module.css'
import { SCHEMA_PLACEHOLDER } from '@/platform/lib/data/workflow-editor/tool-input'

/** What deleting a custom tool costs, asked by every surface that edits one. */
export const CUSTOM_TOOL_DELETE_DESCRIPTION =
  'This will permanently delete the tool and remove it from any workflows that are using it. This action cannot be undone.'

interface CustomToolSchemaFieldProps {
  value: string
  onChange: (value: string) => void
  isLoading: boolean
  isStreaming: boolean
  invalid: boolean
  /** Shows the schema without accepting edits, for a viewer who may not change the tool. */
  disabled?: boolean
}

/** The schema half of the custom tool editor: the tool's OpenAI function definition as JSON. */
export function CustomToolSchemaField({
  value,
  onChange,
  isLoading,
  isStreaming,
  invalid,
  disabled = false,
}: CustomToolSchemaFieldProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.editor}>
        <CodeField
          value={value}
          onValueChange={onChange}
          highlight={(code) => highlightSyntax(code, 'json')}
          label='Tool schema'
          placeholder={SCHEMA_PLACEHOLDER}
          disabled={disabled || isLoading || isStreaming}
          streaming={isStreaming}
          invalid={invalid}
        />
      </div>
    </div>
  )
}

/** Why the schema or code cannot be saved, beside the editor's Generate action. */
export function CustomToolError({ message }: { message: string }) {
  return (
    <span className={styles.error} data-type='T052' role='alert'>
      {message}
    </span>
  )
}
