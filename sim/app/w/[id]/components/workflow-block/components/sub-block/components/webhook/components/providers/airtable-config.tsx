import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay as WebhookTestResult } from '../ui/test-result'

interface AirtableConfigProps {
  baseId: string
  setBaseId: (value: string) => void
  tableId: string
  setTableId: (value: string) => void
  includeCellValues: boolean
  setIncludeCellValues: (value: boolean) => void
  isLoadingToken: boolean
  testResult: any // Define a more specific type if possible
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook?: () => void // Optional test function
  webhookId?: string // Webhook ID to enable testing
}

export function AirtableConfig({
  baseId,
  setBaseId,
  tableId,
  setTableId,
  includeCellValues,
  setIncludeCellValues,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook, // We might need this later for instructions
  webhookId, // We might need this later for instructions
}: AirtableConfigProps) {
  return (
    <div className="space-y-4">
      <ConfigSection title="Airtable Configuration">
        <ConfigField
          id="airtable-base-id"
          label="Base ID *"
          description="The ID of the Airtable Base this webhook will monitor."
        >
          {isLoadingToken ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="airtable-base-id"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
              placeholder="appXXXXXXXXXXXXXX"
              required
            />
          )}
        </ConfigField>

        <ConfigField
          id="airtable-table-id"
          label="Table ID *"
          description="The ID of the table within the Base that the webhook will monitor."
        >
          {isLoadingToken ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="airtable-table-id"
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              placeholder="tblXXXXXXXXXXXXXX"
              required
            />
          )}
        </ConfigField>

        <div className="flex items-center justify-between rounded-lg border border-border p-3 shadow-sm bg-background">
          <div className="space-y-0.5 pr-4">
            <Label htmlFor="include-cell-values" className="font-normal">
              Include Full Record Data
            </Label>
            <p className="text-xs text-muted-foreground">
              Enable to receive the complete record data in the payload, not just changes.
            </p>
          </div>
          {isLoadingToken ? (
            <Skeleton className="h-5 w-9" />
          ) : (
            <Switch
              id="include-cell-values"
              checked={includeCellValues}
              onCheckedChange={setIncludeCellValues}
              disabled={isLoadingToken}
            />
          )}
        </div>
      </ConfigSection>

      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}

      <InstructionsSection tip="Airtable webhooks monitor changes in your base/table and trigger your workflow.">
        <ol className="list-decimal list-inside space-y-1">
          <li>Ensure you have provided the correct Base ID and Table ID above.</li>
          <li>
            Sim Studio will automatically configure the webhook in your Airtable account when you
            save.
          </li>
          <li>Any changes made to records in the specified table will trigger this workflow.</li>
          <li>
            If 'Include Full Record Data' is enabled, the entire record will be sent; otherwise,
            only the changed fields are sent.
          </li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
