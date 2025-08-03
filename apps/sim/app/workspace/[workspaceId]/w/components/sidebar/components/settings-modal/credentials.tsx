import { useState } from 'react'
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { useGeneralStore } from '@/stores/settings/general/store'

export function Credentials({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { provider, setProvider, customOpenAI, setCustomOpenAI } = useGeneralStore((state) => ({
    provider: state.llmProvider,
    setProvider: state.setLLMProvider,
    customOpenAI: state.customOpenAI || {
      baseURL: '',
      modelName: '',
      apiKey: '',
    },
    setCustomOpenAI: state.setCustomOpenAI,
  }))

  const handleInputChange = (key: keyof typeof customOpenAI, value: string) => {
    setCustomOpenAI({
      ...customOpenAI,
      [key]: value ,
    })
  }

  return (
    <div className="space-y-4 p-6">
      <Label>LLM Provider</Label>
      <Select value={provider} onValueChange={setProvider}>
        <SelectTrigger className="w-[300px]">
          <SelectValue placeholder="Select a provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">OpenAI</SelectItem>
          <SelectItem value="azure">Azure</SelectItem>
          <SelectItem value="custom-openai">Custom OpenAI (Ollama / LM Studio)</SelectItem>
        </SelectContent>
      </Select>

      {provider === 'custom-openai' && (
        <div className="space-y-3 mt-4">
          <div>
            <Label>Base URL</Label>
            <Input
              value={customOpenAI.baseURL}
              onChange={(e) => handleInputChange('baseURL', e.target.value)}
              placeholder="http://localhost:11434/v1"
            />
          </div>
          <div>
            <Label>Model Name</Label>
            <Input
              value={customOpenAI.modelName}
              onChange={(e) => handleInputChange('modelName', e.target.value)}
              placeholder="llama3, mistral, etc"
            />
          </div>
          <div>
            <Label>API Key (optional)</Label>
            <Input
              value={customOpenAI.apiKey}
              onChange={(e) => handleInputChange('apiKey', e.target.value)}
              placeholder="sk-xxxxxx"
            />
          </div>
        </div>
      )}
    </div>
  )
}