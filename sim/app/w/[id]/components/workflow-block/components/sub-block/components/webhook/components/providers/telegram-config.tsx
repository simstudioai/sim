import React from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfigField } from '../ui/config-field'
import { ConfigSection } from '../ui/config-section'
import { InstructionsSection } from '../ui/instructions-section'
import { TestResultDisplay as WebhookTestResult } from '../ui/test-result'
import { WebhookConfigField } from '../ui/webhook-config-field'

interface TelegramConfigProps {
  botToken: string
  setBotToken: (value: string) => void
  chatId: string
  setChatId: (value: string) => void
  isLoadingToken: boolean
  testResult: any // Define a more specific type if possible
  copied: string | null
  copyToClipboard: (text: string, type: string) => void
  testWebhook?: () => void // Optional test function
  webhookId?: string // Webhook ID to enable testing
  webhookUrl: string // Added webhook URL
}

export function TelegramConfig({
  botToken,
  setBotToken,
  chatId,
  setChatId,
  isLoadingToken,
  testResult,
  copied,
  copyToClipboard,
  testWebhook,
  webhookId,
  webhookUrl,
}: TelegramConfigProps) {
  return (
    <div className="space-y-4">
      <ConfigSection title="Telegram Configuration">
        <WebhookConfigField
          id="webhook-url"
          label="Webhook URL"
          value={webhookUrl}
          description="This is the URL that will receive webhook requests from Telegram"
          isLoading={isLoadingToken}
          copied={copied}
          copyType="url"
          copyToClipboard={copyToClipboard}
          readOnly={true}
        />

        <ConfigField
          id="telegram-bot-token"
          label="Bot Token *"
          description="Your Telegram Bot Token from BotFather"
        >
          {isLoadingToken ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="telegram-bot-token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              type="password"
              required
            />
          )}
        </ConfigField>

        <ConfigField
          id="telegram-chat-id"
          label="Chat ID *"
          description="The ID of the chat where messages will be sent"
        >
          {isLoadingToken ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Input
              id="telegram-chat-id"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="123456789"
              required
            />
          )}
        </ConfigField>
      </ConfigSection>

      {testResult && (
        <WebhookTestResult
          testResult={testResult}
          copied={copied}
          copyToClipboard={copyToClipboard}
        />
      )}

      <InstructionsSection tip="Telegram webhooks allow your bot to receive updates and send messages to specific chats.">
        <ol className="list-decimal list-inside space-y-1">
          <li>Create a bot using BotFather and get your bot token.</li>
          <li>Add your bot to the target chat and make it an admin if needed.</li>
          <li>Get the chat ID by forwarding a message from the target chat to @userinfobot.</li>
          <li>Sim Studio will automatically configure the webhook in your Telegram bot when you save.</li>
          <li>Your bot will now be able to send messages to the specified chat.</li>
        </ol>
      </InstructionsSection>
    </div>
  )
}
