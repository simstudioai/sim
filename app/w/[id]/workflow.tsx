'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  Background,
  ConnectionLineType,
  EdgeTypes,
  NodeTypes,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { WebhookConfig, WorkflowMetadata } from '@/lib/types'
import { useNotificationStore } from '@/stores/notifications/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { initializeStateLogger } from '@/stores/workflow/logger'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { useWorkflowStore } from '@/stores/workflow/store'
import { NotificationList } from '@/app/w/components/notifications/notifications'
import { getBlock } from '../../../blocks'
import { ErrorBoundary } from '../components/error-boundary/error-boundary'
import { CustomEdge } from './components/custom-edge/custom-edge'
import { WorkflowBlock } from './components/workflow-block/workflow-block'
import { LoopInput } from './components/workflow-loop/components/loop-input/loop-input'
import { LoopLabel } from './components/workflow-loop/components/loop-label/loop-label'
import { createLoopNode, getRelativeLoopPosition } from './components/workflow-loop/workflow-loop'

// Define custom node and edge types
const nodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  loopLabel: LoopLabel,
  loopInput: LoopInput,
}
const edgeTypes: EdgeTypes = { custom: CustomEdge }

function WorkflowContent() {
  // State
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [webhookEnabled, setWebhookEnabled] = useState(false)
  const [webhookSecret, setWebhookSecret] = useState('')
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')

  // Hooks
  const params = useParams()
  const router = useRouter()
  const { project } = useReactFlow()

  // Store access
  const { addNotification } = useNotificationStore()
  const { workflows, setActiveWorkflow, createWorkflow } = useWorkflowRegistry()
  const { blocks, edges, loops, addBlock, updateBlockPosition, addEdge, removeEdge } =
    useWorkflowStore()

  // Initialize workflow
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedRegistry = localStorage.getItem('workflow-registry')
      if (savedRegistry) {
        useWorkflowRegistry.setState({ workflows: JSON.parse(savedRegistry) })
      }
      setIsInitialized(true)
    }
  }, [])

  // Update notification function to handle webhook status
  const notifyWebhookStatus = (enabled: boolean, success: boolean, error?: string) => {
    const currentId = params?.id as string
    if (success) {
      addNotification(
        'api',
        enabled
          ? 'Webhook has been successfully enabled. Use the generated URL to send requests to this workflow.'
          : 'Webhook has been disabled.',
        currentId,
        {
          isPersistent: false,
        }
      )
    } else {
      addNotification(
        'error',
        error || 'An error occurred while configuring the webhook',
        currentId,
        {
          isPersistent: true,
        }
      )
    }
  }

  // Update useEffect for safe params handling
  useEffect(() => {
    const id = params?.id as string | undefined
    if (!id || !isInitialized) return

    // Save webhook configuration when changed
    const workflow = workflows[id] as unknown as WorkflowMetadata
    const isCurrentlyWebhook = workflow?.executionMethod === 'webhook'

    if (
      webhookEnabled !== isCurrentlyWebhook ||
      (webhookEnabled && (workflow?.webhookConfig as WebhookConfig)?.secretToken !== webhookSecret)
    ) {
      // Call the webhook configuration API
      fetch(`/api/workflow/${id}/webhook/configure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: webhookEnabled,
          secretToken: webhookEnabled ? webhookSecret : undefined,
        }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error('Failed to configure webhook')
          }
          return res.json()
        })
        .then((data) => {
          // Update local state if needed
          if (data.success) {
            notifyWebhookStatus(webhookEnabled, true)
          }
        })
        .catch((err) => {
          console.error('Failed to configure webhook:', err)
          notifyWebhookStatus(
            webhookEnabled,
            false,
            err instanceof Error ? err.message : 'Unknown error'
          )
        })
    }

    const validateAndNavigate = () => {
      const workflowIds = Object.keys(workflows)
      const currentId = id

      if (workflowIds.length === 0) {
        // Create initial workflow using the centralized function
        const newId = createWorkflow({ isInitial: true })
        router.replace(`/w/${newId}`)
        return
      }

      if (!workflows[currentId]) {
        router.replace(`/w/${workflowIds[0]}`)
        return
      }

      setActiveWorkflow(currentId)

      // Create webhook URL
      setWebhookUrl(`${window.location.origin}/api/workflow/${currentId}/webhook/receive`)

      // Check if current workflow has webhook enabled
      const currentWorkflow = workflows[currentId] as unknown as WorkflowMetadata
      if (currentWorkflow && currentWorkflow.executionMethod === 'webhook') {
        setWebhookEnabled(true)
        // Check if webhook config exists and has a secretToken
        const config = currentWorkflow.webhookConfig as WebhookConfig
        if (config?.secretToken) {
          setWebhookSecret(config.secretToken)
        } else {
          // Generate a new secret if none exists
          generateWebhookSecret()
        }
      } else {
        setWebhookEnabled(false)
      }
    }

    validateAndNavigate()
  }, [params?.id, workflows, setActiveWorkflow, createWorkflow, router, isInitialized])

  // Transform blocks and loops into ReactFlow nodes
  const nodes = useMemo(() => {
    const nodeArray: any[] = []

    // Add loop group nodes and their labels
    Object.entries(loops).forEach(([loopId, loop]) => {
      const loopNodes = createLoopNode({ loopId, loop, blocks })
      if (loopNodes) {
        // Add both the loop node and its label node
        nodeArray.push(...loopNodes)
      }
    })

    // Add block nodes
    Object.entries(blocks).forEach(([blockId, block]) => {
      if (!block.type || !block.name) {
        console.log('Skipping invalid block:', blockId, block)
        return
      }

      const blockConfig = getBlock(block.type)
      if (!blockConfig) {
        console.error(`No configuration found for block type: ${block.type}`)
        return
      }

      const parentLoop = Object.entries(loops).find(([_, loop]) => loop.nodes.includes(block.id))
      let position = block.position

      if (parentLoop) {
        const [loopId] = parentLoop
        const loopNode = nodeArray.find((node) => node.id === `loop-${loopId}`)
        if (loopNode) {
          position = getRelativeLoopPosition(block.position, loopNode.position)
        }
      }

      nodeArray.push({
        id: block.id,
        type: 'workflowBlock',
        position,
        parentId: parentLoop ? `loop-${parentLoop[0]}` : undefined,
        dragHandle: '.workflow-drag-handle',
        data: {
          type: block.type,
          config: blockConfig,
          name: block.name,
        },
      })
    })

    return nodeArray
  }, [blocks, loops])

  // Update nodes
  const onNodesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'position' && change.position) {
          const node = nodes.find((n) => n.id === change.id)
          if (!node) return

          if (node.parentId) {
            const loopNode = nodes.find((n) => n.id === node.parentId)
            if (loopNode) {
              const absolutePosition = {
                x: change.position.x + loopNode.position.x,
                y: change.position.y + loopNode.position.y,
              }
              updateBlockPosition(change.id, absolutePosition)
            }
          } else {
            updateBlockPosition(change.id, change.position)
          }
        }
      })
    },
    [nodes, updateBlockPosition]
  )

  // Update edges
  const onEdgesChange = useCallback(
    (changes: any) => {
      changes.forEach((change: any) => {
        if (change.type === 'remove') {
          removeEdge(change.id)
        }
      })
    },
    [removeEdge]
  )

  // Handle connections
  const onConnect = useCallback(
    (connection: any) => {
      if (connection.source && connection.target) {
        addEdge({
          ...connection,
          id: crypto.randomUUID(),
          type: 'custom',
        })
      }
    },
    [addEdge]
  )

  // Handle drops
  const findClosestOutput = useCallback(
    (newNodePosition: { x: number; y: number }) => {
      const existingBlocks = Object.entries(blocks)
        .filter(([_, block]) => block.enabled && block.type !== 'condition')
        .map(([id, block]) => ({
          id,
          position: block.position,
          distance: Math.sqrt(
            Math.pow(block.position.x - newNodePosition.x, 2) +
              Math.pow(block.position.y - newNodePosition.y, 2)
          ),
        }))
        .sort((a, b) => a.distance - b.distance)

      return existingBlocks[0]?.id
    },
    [blocks]
  )

  // Update the onDrop handler
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      try {
        const data = JSON.parse(event.dataTransfer.getData('application/json'))
        if (data.type === 'connectionBlock') return

        const reactFlowBounds = event.currentTarget.getBoundingClientRect()
        const position = project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })

        const blockConfig = getBlock(data.type)
        if (!blockConfig) {
          console.error('Invalid block type:', data.type)
          return
        }

        const id = crypto.randomUUID()
        const name = `${blockConfig.name} ${
          Object.values(blocks).filter((b) => b.type === data.type).length + 1
        }`

        addBlock(id, data.type, name, position)

        // Auto-connect logic
        const isAutoConnectEnabled = useGeneralStore.getState().isAutoConnectEnabled
        if (isAutoConnectEnabled && data.type !== 'starter') {
          const closestBlockId = findClosestOutput(position)
          if (closestBlockId) {
            addEdge({
              id: crypto.randomUUID(),
              source: closestBlockId,
              target: id,
              sourceHandle: 'source',
              targetHandle: 'target',
              type: 'custom',
            })
          }
        }
      } catch (err) {
        console.error('Error dropping block:', err)
      }
    },
    [project, blocks, addBlock, addEdge, findClosestOutput]
  )

  // Update onPaneClick to only handle edge selection
  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null)
  }, [])

  // Edge selection
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: any) => {
    setSelectedEdgeId(edge.id)
  }, [])

  // Transform edges to include selection state
  const edgesWithSelection = edges.map((edge) => ({
    ...edge,
    type: edge.type || 'custom',
    data: {
      selectedEdgeId,
      onDelete: (edgeId: string) => {
        removeEdge(edgeId)
        setSelectedEdgeId(null)
      },
    },
  }))

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
        removeEdge(selectedEdgeId)
        setSelectedEdgeId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeId, removeEdge])

  // Initialize state logging
  // useEffect(() => {
  //   initializeStateLogger()
  // }, [])

  // Generate webhook secret
  const generateWebhookSecret = () => {
    const randomBytes = new Uint8Array(32)
    crypto.getRandomValues(randomBytes)
    const secret = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 32)
    setWebhookSecret(secret)
  }

  if (!isInitialized) return null

  return (
    <div className="relative w-full h-[calc(100vh-4rem)]">
      <NotificationList />
      <ReactFlow
        nodes={nodes}
        edges={edgesWithSelection}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        fitView
        minZoom={0.4}
        maxZoom={1}
        panOnScroll
        defaultEdgeOptions={{ type: 'custom' }}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{
          stroke: '#94a3b8',
          strokeWidth: 2,
          strokeDasharray: '5,5',
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        onNodeClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
        }}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        elementsSelectable={true}
        selectNodesOnDrag={false}
        nodesConnectable={true}
        nodesDraggable={true}
        draggable={false}
        noWheelClassName="allow-scroll"
        edgesFocusable={true}
        edgesUpdatable={true}
      >
        <Background />
      </ReactFlow>

      {/* Execution Method Section */}
      <div className="mt-6 border rounded-md p-4">
        <h3 className="text-lg font-medium">Execution Method</h3>
        <div className="mt-2 space-y-3">
          {/* Manual execution option */}
          <div className="flex items-center">
            <input
              type="radio"
              id="manual"
              name="executionMethod"
              value="manual"
              checked={!webhookEnabled}
              onChange={() => {
                setWebhookEnabled(false)
              }}
              className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
            />
            <label htmlFor="manual" className="ml-2 block text-sm">
              Manual Execution
            </label>
          </div>

          {/* Webhook execution option - new */}
          <div className="flex items-center">
            <input
              type="radio"
              id="webhook"
              name="executionMethod"
              value="webhook"
              checked={webhookEnabled}
              onChange={() => {
                setWebhookEnabled(!webhookEnabled)
                if (!webhookSecret) {
                  generateWebhookSecret()
                }
              }}
              className="h-4 w-4 text-primary focus:ring-primary border-gray-300"
            />
            <label htmlFor="webhook" className="ml-2 block text-sm">
              Webhook (Trigger from external services)
            </label>
          </div>

          {/* Webhook configuration options - new */}
          {webhookEnabled && (
            <div className="mt-4 pl-6 space-y-4">
              <div>
                <label className="block text-sm font-medium">Webhook URL</label>
                <div className="mt-1 flex">
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="flex-1 min-w-0 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(webhookUrl)}
                    className="ml-2 inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Use this URL in your external service to trigger this workflow
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium">Secret Token</label>
                <div className="mt-1 flex">
                  <div className="relative flex-grow">
                    <input
                      type={showWebhookSecret ? 'text' : 'password'}
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowWebhookSecret(!showWebhookSecret)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showWebhookSecret ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={generateWebhookSecret}
                    className="ml-2 inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
                  >
                    Generate
                  </button>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Use this token to secure your webhook (recommended)
                </p>
              </div>

              <div className="bg-yellow-50 p-4 rounded-md">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-yellow-400"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">Security Information</h3>
                    <div className="mt-2 text-sm text-yellow-700">
                      <p>When using webhooks, we recommend:</p>
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>Use the secret token to validate incoming requests</li>
                        <li>
                          Set the <code>x-webhook-signature</code> header with HMAC SHA-256 of the
                          payload
                        </li>
                        <li>Keep your webhook URL and secret token secure</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Workflow wrapper
export default function Workflow() {
  return (
    <ReactFlowProvider>
      <ErrorBoundary>
        <WorkflowContent />
      </ErrorBoundary>
    </ReactFlowProvider>
  )
}
