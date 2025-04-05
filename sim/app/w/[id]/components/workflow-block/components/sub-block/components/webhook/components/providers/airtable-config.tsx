import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
  testWebhook,
  webhookId,
}: AirtableConfigProps) {
  return (
    <div className="space-y-4">
      {/* Base ID Input */}
      <div className="space-y-1">
        <Label htmlFor="airtable-base-id">Base ID *</Label>
        {isLoadingToken ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Input
            id="airtable-base-id"
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            placeholder="appXXXXXXXXXXXXXX"
            required
          />
        )}
        <p className="text-xs text-muted-foreground">
          The ID of the Airtable Base this webhook will monitor.
        </p>
      </div>

      {/* Table ID Input */}
      <div className="space-y-1">
        <Label htmlFor="airtable-table-id">Table ID *</Label>
        {isLoadingToken ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Input
            id="airtable-table-id"
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            placeholder="tblXXXXXXXXXXXXXX"
            required
          />
        )}
        <p className="text-xs text-muted-foreground">
          The ID of the table within the Base that the webhook will monitor.
        </p>
      </div>

      {/* Include Cell Values Switch */}
      <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
        <div className="space-y-0.5">
          <Label htmlFor="include-cell-values">Include Full Record Data</Label>
          <p className="text-[0.8rem] text-muted-foreground">
            Enable to receive the complete record data in the webhook payload, not just changes.
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

      {/* Test Result Display */}
      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}
    </div>
  )
}
