'use client'

import { CopyButton } from '@/components/ui/copy-button'
import { Label } from '@/components/ui/label'

interface ExampleCommandProps {
  command: string
  apiKey: string
  showLabel?: boolean
}

export function ExampleCommand({ command, apiKey, showLabel = true }: ExampleCommandProps) {
  // Format the curl command to use a placeholder for the API key
  const formatCurlCommand = (command: string, apiKey: string) => {
    if (!command.includes('curl')) return command

    // Replace the actual API key with a placeholder in the command
    const sanitizedCommand = command.replace(apiKey, 'SIM_API_KEY')

    // Format the command with line breaks for better readability
    return sanitizedCommand
      .replace(' -H ', '\n  -H ')
      .replace(' -d ', '\n  -d ')
      .replace(' http', '\n  http')
  }

  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="flex items-center gap-1.5">
          <Label className="font-medium text-sm">Example Command</Label>
        </div>
      )}
      <div className="relative group rounded-md border bg-background hover:bg-muted/50 transition-colors">
        <pre className="p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto">
          {formatCurlCommand(command, apiKey)}
        </pre>
        <CopyButton text={command} />
      </div>
    </div>
  )
}
