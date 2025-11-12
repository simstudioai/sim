'use client'

import { Plus, X } from 'lucide-react'
import { Button, Input, Label } from '@/components/emcn'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import type { McpServerFormData, McpServerTestResult } from '../types'

interface AddServerFormProps {
  formData: McpServerFormData
  testResult: McpServerTestResult | null
  isTestingConnection: boolean
  isAddingServer: boolean
  serversLoading: boolean
  showEnvVars: boolean
  activeInputField: 'url' | 'header-key' | 'header-value' | null
  activeHeaderIndex: number | null
  envSearchTerm: string
  cursorPosition: number
  urlScrollLeft: number
  headerScrollLeft: Record<string, number>
  workspaceId: string
  urlInputRef: React.RefObject<HTMLInputElement | null>
  onNameChange: (value: string) => void
  onInputChange: (
    field: 'url' | 'header-key' | 'header-value',
    value: string,
    index?: number
  ) => void
  onUrlScroll: (scrollLeft: number) => void
  onHeaderScroll: (key: string, scrollLeft: number) => void
  onEnvVarSelect: (value: string) => void
  onEnvVarClose: () => void
  onAddHeader: () => void
  onRemoveHeader: (key: string) => void
  onTestConnection: () => void
  onCancel: () => void
  onAddServer: () => void
  onClearTestResult: () => void
}

export function AddServerForm({
  formData,
  testResult,
  isTestingConnection,
  isAddingServer,
  serversLoading,
  showEnvVars,
  activeInputField,
  activeHeaderIndex,
  envSearchTerm,
  cursorPosition,
  urlScrollLeft,
  headerScrollLeft,
  workspaceId,
  urlInputRef,
  onNameChange,
  onInputChange,
  onUrlScroll,
  onHeaderScroll,
  onEnvVarSelect,
  onEnvVarClose,
  onAddHeader,
  onRemoveHeader,
  onTestConnection,
  onCancel,
  onAddServer,
  onClearTestResult,
}: AddServerFormProps) {
  return (
    <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
      <div className='space-y-1.5'>
        <div className='flex items-center justify-between gap-3'>
          <Label className='w-[100px] shrink-0 font-normal text-sm'>Server Name</Label>
          <div className='flex-1'>
            <Input
              placeholder='e.g., My MCP Server'
              value={formData.name}
              onChange={(e) => {
                if (testResult) onClearTestResult()
                onNameChange(e.target.value)
              }}
              className='h-9'
            />
          </div>
        </div>

        <div className='flex items-center justify-between gap-3'>
          <Label className='w-[100px] shrink-0 font-normal text-sm'>Server URL</Label>
          <div className='relative flex-1'>
            <Input
              ref={urlInputRef}
              placeholder='https://mcp.server.dev/{{YOUR_API_KEY}}/sse'
              value={formData.url}
              onChange={(e) => onInputChange('url', e.target.value)}
              onScroll={(e) => onUrlScroll(e.currentTarget.scrollLeft)}
              onInput={(e) => onUrlScroll(e.currentTarget.scrollLeft)}
              className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
            />
            {/* Overlay for styled text display */}
            <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
              <div
                className='whitespace-nowrap'
                style={{ transform: `translateX(-${urlScrollLeft}px)` }}
              >
                {formatDisplayText(formData.url || '')}
              </div>
            </div>

            {/* Environment Variables Dropdown */}
            {showEnvVars && activeInputField === 'url' && (
              <EnvVarDropdown
                visible={showEnvVars}
                onSelect={onEnvVarSelect}
                searchTerm={envSearchTerm}
                inputValue={formData.url || ''}
                cursorPosition={cursorPosition}
                workspaceId={workspaceId}
                onClose={onEnvVarClose}
                className='w-full'
                maxHeight='200px'
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  zIndex: 99999,
                }}
              />
            )}
          </div>
        </div>

        {Object.entries(formData.headers || {}).map(([key, value], index) => (
          <div key={index} className='relative flex items-center justify-between gap-3'>
            <Label className='w-[100px] shrink-0 font-normal text-sm'>Header</Label>
            <div className='relative flex flex-1 gap-2'>
              {/* Header Key Input */}
              <div className='relative flex-1'>
                <Input
                  placeholder='Name'
                  value={key}
                  onChange={(e) => onInputChange('header-key', e.target.value, index)}
                  onScroll={(e) => onHeaderScroll(`key-${index}`, e.currentTarget.scrollLeft)}
                  onInput={(e) => onHeaderScroll(`key-${index}`, e.currentTarget.scrollLeft)}
                  className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                />
                <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                  <div
                    className='whitespace-nowrap'
                    style={{
                      transform: `translateX(-${headerScrollLeft[`key-${index}`] || 0}px)`,
                    }}
                  >
                    {formatDisplayText(key || '')}
                  </div>
                </div>
              </div>

              {/* Header Value Input */}
              <div className='relative flex-1'>
                <Input
                  placeholder='Value'
                  value={value}
                  onChange={(e) => onInputChange('header-value', e.target.value, index)}
                  onScroll={(e) => onHeaderScroll(`value-${index}`, e.currentTarget.scrollLeft)}
                  onInput={(e) => onHeaderScroll(`value-${index}`, e.currentTarget.scrollLeft)}
                  className='h-9 text-transparent caret-foreground placeholder:text-muted-foreground/50'
                />
                <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden px-3 text-sm'>
                  <div
                    className='whitespace-nowrap'
                    style={{
                      transform: `translateX(-${headerScrollLeft[`value-${index}`] || 0}px)`,
                    }}
                  >
                    {formatDisplayText(value || '')}
                  </div>
                </div>
              </div>

              <Button
                type='button'
                variant='ghost'
                onClick={() => onRemoveHeader(key)}
                className='h-9 w-9 p-0 text-muted-foreground hover:text-foreground'
              >
                <X className='h-3 w-3' />
              </Button>

              {/* Environment Variables Dropdown for Header Key */}
              {showEnvVars && activeInputField === 'header-key' && activeHeaderIndex === index && (
                <EnvVarDropdown
                  visible={showEnvVars}
                  onSelect={onEnvVarSelect}
                  searchTerm={envSearchTerm}
                  inputValue={key}
                  cursorPosition={cursorPosition}
                  workspaceId={workspaceId}
                  onClose={onEnvVarClose}
                  className='w-full'
                  maxHeight='200px'
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 99999,
                  }}
                />
              )}

              {/* Environment Variables Dropdown for Header Value */}
              {showEnvVars &&
                activeInputField === 'header-value' &&
                activeHeaderIndex === index && (
                  <EnvVarDropdown
                    visible={showEnvVars}
                    onSelect={onEnvVarSelect}
                    searchTerm={envSearchTerm}
                    inputValue={value}
                    cursorPosition={cursorPosition}
                    workspaceId={workspaceId}
                    onClose={onEnvVarClose}
                    className='w-full'
                    maxHeight='200px'
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      zIndex: 99999,
                    }}
                  />
                )}
            </div>
          </div>
        ))}

        <div className='flex items-center justify-between gap-3'>
          <div className='w-[100px] shrink-0' />
          <div className='flex-1'>
            <Button
              type='button'
              variant='outline'
              onClick={onAddHeader}
              className='h-9 text-muted-foreground hover:text-foreground'
            >
              <Plus className='mr-2 h-3 w-3' />
              Add Header
            </Button>
          </div>
        </div>

        <div className='border-border border-t pt-2'>
          <div className='space-y-1.5'>
            {/* Error message above buttons */}
            {testResult && !testResult.success && (
              <div className='text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
                {testResult.error || testResult.message}
              </div>
            )}

            {/* Buttons row */}
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  onClick={onTestConnection}
                  disabled={isTestingConnection || !formData.name.trim() || !formData.url?.trim()}
                  className='h-9 text-muted-foreground hover:text-foreground'
                >
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </Button>
                {testResult?.success && (
                  <span className='text-muted-foreground text-xs'>✓ Connected</span>
                )}
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  onClick={onCancel}
                  className='h-9 text-muted-foreground hover:text-foreground'
                >
                  Cancel
                </Button>
                <Button
                  onClick={onAddServer}
                  disabled={
                    serversLoading ||
                    isAddingServer ||
                    !formData.name.trim() ||
                    !formData.url?.trim()
                  }
                  className='h-9 rounded-[8px]'
                >
                  {serversLoading || isAddingServer ? 'Adding...' : 'Add Server'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
