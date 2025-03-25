'use client'

import { useEffect, useState } from 'react'
import { Copy, MoreVertical, Plus, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useVariablesStore } from '../../stores/variables/store'
import { Variable, VariableType } from '../../stores/variables/types'

interface VariablesProps {
  panelWidth: number
}

export function Variables({ panelWidth }: VariablesProps) {
  const { activeWorkflowId } = useWorkflowRegistry()
  const {
    variables: storeVariables,
    addVariable,
    updateVariable,
    deleteVariable,
    duplicateVariable,
    getVariablesByWorkflowId,
  } = useVariablesStore()

  // Get variables for the current workflow
  const workflowVariables = activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []

  // Auto-save when variables are added/edited
  const handleAddVariable = () => {
    if (!activeWorkflowId) return

    // Create a default variable
    const id = addVariable({
      name: `Variable ${Object.keys(storeVariables).length + 1}`,
      type: 'string',
      value: '',
      workflowId: activeWorkflowId,
    })

    return id
  }

  const getTypeIcon = (type: VariableType) => {
    switch (type) {
      case 'string':
        return 'Aa'
      case 'number':
        return '123'
      case 'boolean':
        return '0/1'
      case 'object':
        return '{}'
      case 'array':
        return '[]'
      default:
        return '?'
    }
  }

  const handleTypeClick = (variable: Variable) => {
    // Cycle through types: string -> number -> boolean -> object -> array -> string
    const types: VariableType[] = ['string', 'number', 'boolean', 'object', 'array']
    const currentIndex = types.indexOf(variable.type)
    const nextType = types[(currentIndex + 1) % types.length]

    updateVariable(variable.id, { type: nextType })
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 pb-16 space-y-2">
        {/* Variables List */}
        {workflowVariables.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-muted-foreground mb-2">No variables yet</div>
            <Button variant="outline" size="sm" className="text-xs" onClick={handleAddVariable}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add your first variable
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {workflowVariables.map((variable) => (
                <div
                  key={variable.id}
                  className="group flex items-center space-x-2 rounded-md border bg-background p-2 hover:bg-accent/30 transition-colors"
                >
                  <Input
                    className="flex-1 h-8 focus-visible:ring-0 border-none bg-transparent focus-visible:bg-background"
                    placeholder="Variable name"
                    value={variable.name}
                    onChange={(e) => updateVariable(variable.id, { name: e.target.value })}
                  />

                  <div
                    className="flex-none flex items-center justify-center rounded-md w-12 h-8 bg-muted/40 cursor-pointer hover:bg-muted/70 transition-colors"
                    onClick={() => handleTypeClick(variable)}
                  >
                    <span className="text-sm text-muted-foreground">
                      {getTypeIcon(variable.type)}
                    </span>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => duplicateVariable(variable.id)}
                        className="cursor-pointer"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => deleteVariable(variable.id)}
                        className="cursor-pointer text-destructive focus:text-destructive"
                      >
                        <Trash className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>

            {/* Add Variable Button */}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={handleAddVariable}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add variable
            </Button>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
