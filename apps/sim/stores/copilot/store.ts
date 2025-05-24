import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { useEnvironmentStore } from '../settings/environment/store'
import { useWorkflowStore } from '../workflows/workflow/store'
import type { CopilotMessage, CopilotStore } from './types'
import { calculateBlockPosition, getNextBlockNumber } from './utils'

const logger = createLogger('CopilotStore')

export const useCopilotStore = create<CopilotStore>()(
  devtools(
    (set, get) => ({
      messages: [],
      isProcessing: false,
      error: null,

      sendMessage: async (content: string) => {
        try {
          set({ isProcessing: true, error: null })

          const workflowStore = useWorkflowStore.getState()
          const apiKey = useEnvironmentStore.getState().getVariable('OPENAI_API_KEY')

          if (!apiKey) {
            throw new Error(
              'OpenAI API key not found. Please add it to your environment variables.'
            )
          }

          // User message
          const newMessage: CopilotMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: content.trim(),
            timestamp: Date.now(),
          }

          // Format messages for OpenAI API
          const formattedMessages = [
            ...get().messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
            {
              role: newMessage.role,
              content: newMessage.content,
            },
          ]

          // Add message to local state first
          set((state) => ({
            messages: [...state.messages, newMessage],
          }))

          const response = await fetch('/api/copilot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-OpenAI-Key': apiKey,
            },
            body: JSON.stringify({
              messages: formattedMessages,
              workflowState: {
                blocks: workflowStore.blocks,
                edges: workflowStore.edges,
              },
            }),
          })

          if (!response.ok) {
            throw new Error('Failed to send message')
          }

          const data = await response.json()

          // Handle any actions returned from the API
          if (data.actions) {
            // Process all block additions first to properly calculate positions
            const blockActions = data.actions.filter((action: any) => action.name === 'addBlock')

            blockActions.forEach((action: any, index: number) => {
              const { type, name } = action.parameters
              const id = crypto.randomUUID()

              // Calculate position based on current blocks and action index
              const position = calculateBlockPosition(workflowStore.blocks, index)

              // Generate name if not provided
              const blockName = name || `${type} ${getNextBlockNumber(workflowStore.blocks, type)}`

              workflowStore.addBlock(id, type, blockName, position)
            })

            // Handle other actions (edges, removals, etc.)
            const otherActions = data.actions.filter((action: any) => action.name !== 'addBlock')

            otherActions.forEach((action: any) => {
              switch (action.name) {
                case 'addEdge': {
                  const { sourceId, targetId, sourceHandle, targetHandle } = action.parameters
                  workflowStore.addEdge({
                    id: crypto.randomUUID(),
                    source: sourceId,
                    target: targetId,
                    sourceHandle,
                    targetHandle,
                    type: 'custom',
                  })
                  break
                }
                case 'removeBlock': {
                  workflowStore.removeBlock(action.parameters.id)
                  break
                }
                case 'removeEdge': {
                  workflowStore.removeEdge(action.parameters.id)
                  break
                }
              }
            })
          }

          // Add assistant's response to chat
          if (data.message) {
            set((state) => ({
              messages: [
                ...state.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: data.message,
                  timestamp: Date.now(),
                },
              ],
            }))
          }
        } catch (error) {
          logger.error('Copilot error:', { error })
          set({
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        } finally {
          set({ isProcessing: false })
        }
      },

      clearCopilot: () => set({ messages: [], error: null }),
      setError: (error) => set({ error }),
    }),
    { name: 'copilot-store' }
  )
)
