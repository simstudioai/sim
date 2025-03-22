'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ControlBar } from './components/control-bar/control-bar'
import { ErrorMessage } from './components/error-message'
import { Section } from './components/section'
import { Toolbar } from './components/toolbar/toolbar'
import { WorkflowCard } from './components/workflow-card'
import { WorkflowCardSkeleton } from './components/workflow-card-skeleton'

// Types
export interface Workflow {
  id: string
  name: string
  description: string
  author: string
  stars: number
  views: number
  tags: string[]
  thumbnail?: string
  workflowUrl?: string
  workflowState?: {
    blocks: Record<string, any>
    edges: Array<{
      id: string
      source: string
      target: string
      sourceHandle?: string
      targetHandle?: string
    }>
    loops: Record<string, any>
  }
}

// Mock data for workflows
export const mockWorkflows: Record<string, Workflow[]> = {
  popular: [
    {
      id: '1',
      name: 'Customer Support Bot',
      description:
        'Automated customer support workflow with ticket management and response generation',
      author: 'SupportAI',
      stars: 245,
      views: 1200,
      tags: ['support', 'ai', 'automation'],
      thumbnail: '/thumbnails/customer-support.png',
      workflowState: {
        blocks: {
          '56367072-4db5-4772-a4d4-7cc6c39426c6': {
            id: '56367072-4db5-4772-a4d4-7cc6c39426c6',
            type: 'starter',
            name: 'Start',
            position: {
              x: -20,
              y: -84.61702910193597,
            },
          },
          'f92496b8-0bc0-4d55-bb24-d248d37eb46f': {
            id: 'f92496b8-0bc0-4d55-bb24-d248d37eb46f',
            type: 'jina',
            name: 'Jina 1',
            position: {
              x: 623.1435003505945,
              y: -38.2306610737525,
            },
          },
        },
        edges: [
          {
            id: 'f53a00be-6c87-4350-8ae3-e6e0896c20ce',
            source: '56367072-4db5-4772-a4d4-7cc6c39426c6',
            target: 'f92496b8-0bc0-4d55-bb24-d248d37eb46f',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        loops: {},
      },
    },
    {
      id: '2',
      name: 'Content Generator',
      description: 'Generate blog posts, social media content, and marketing materials with AI',
      author: 'ContentAI',
      stars: 187,
      views: 987,
      tags: ['content', 'generation', 'marketing'],
      thumbnail: '/thumbnails/content-generator.png',
    },
    {
      id: '3',
      name: 'Data Analysis Pipeline',
      description: 'Analyze and visualize complex data sets with this powerful workflow system',
      author: 'DataWizard',
      stars: 156,
      views: 756,
      tags: ['data', 'analysis', 'visualization'],
      thumbnail: '/thumbnails/data-analysis.png',
      workflowUrl: 'http://localhost:3000/w/015c6af0-acf0-464b-99d0-f6e93de94fb9',
    },
    {
      id: '4',
      name: 'Data Analysis Pipeline',
      description: 'Analyze and visualize complex data sets with this powerful workflow system',
      author: 'DataWizard',
      stars: 156,
      views: 756,
      tags: ['data', 'analysis', 'visualization'],
      thumbnail: '/thumbnails/data-analysis.png',
      workflowUrl: 'http://localhost:3000/w/015c6af0-acf0-464b-99d0-f6e93de94fb9',
    },
    {
      id: '5',
      name: 'Data Analysis Pipeline',
      description: 'Analyze and visualize complex data sets with this powerful workflow system',
      author: 'DataWizard',
      stars: 156,
      views: 756,
      tags: ['data', 'analysis', 'visualization'],
      thumbnail: '/thumbnails/data-analysis.png',
      workflowUrl: 'http://localhost:3000/w/015c6af0-acf0-464b-99d0-f6e93de94fb9',
    },
    {
      id: '6',
      name: 'Data Analysis Pipeline',
      description: 'Analyze and visualize complex data sets with this powerful workflow system',
      author: 'DataWizard',
      stars: 156,
      views: 756,
      tags: ['data', 'analysis', 'visualization'],
      thumbnail: '/thumbnails/data-analysis.png',
      workflowUrl: 'http://localhost:3000/w/015c6af0-acf0-464b-99d0-f6e93de94fb9',
    },
  ],
  programming: [
    {
      id: '4',
      name: 'Email Automation',
      description: 'Automate your email campaigns with personalized content and scheduling tools',
      author: 'EmailPro',
      stars: 143,
      views: 543,
      tags: ['email', 'automation', 'marketing'],
      thumbnail: '/thumbnails/email-automation.png',
      workflowUrl: 'http://localhost:3000/w/015c6af0-acf0-464b-99d0-f6e93de94fb9',
    },
    {
      id: '5',
      name: 'Social Media Manager',
      description: 'Schedule and post to multiple social media platforms with analytics tracking',
      author: 'SocialGenius',
      stars: 132,
      views: 432,
      tags: ['social', 'media', 'content'],
      thumbnail: '/thumbnails/social-media.png',
      workflowUrl: 'http://localhost:3000/w/015c6af0-acf0-464b-99d0-f6e93de94fb9',
    },
    {
      id: '6',
      name: 'Marketing Analytics',
      description: 'Track and analyze your marketing campaigns with comprehensive reporting tools',
      author: 'MarketPro',
      stars: 121,
      views: 421,
      tags: ['marketing', 'analytics', 'reporting'],
      thumbnail: '/thumbnails/marketing-analytics.png',
    },
  ],
  marketing: [
    {
      id: '7',
      name: 'SEO Optimizer',
      description: 'Optimize your content for search engines with keyword analysis and suggestions',
      author: 'SEOPro',
      stars: 121,
      views: 321,
      tags: ['seo', 'marketing', 'content'],
      thumbnail: '/thumbnails/seo-optimizer.png',
    },
    {
      id: '8',
      name: 'Ad Campaign Manager',
      description: 'Create and manage ad campaigns across multiple platforms with budget tracking',
      author: 'AdGenius',
      stars: 110,
      views: 210,
      tags: ['ads', 'marketing', 'campaigns'],
      thumbnail: '/thumbnails/ad-campaign.png',
    },
    {
      id: '9',
      name: 'Email Marketing Suite',
      description: 'Complete email marketing solution with templates, analytics, and A/B testing',
      author: 'EmailMaster',
      stars: 95,
      views: 195,
      tags: ['email', 'marketing', 'templates'],
      thumbnail: '/thumbnails/email-marketing.png',
    },
  ],
}

export default function Marketplace() {
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflowData, setWorkflowData] = useState<Record<string, Workflow[]>>(mockWorkflows)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Create refs for each section
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)

  // Fetch workflows on component mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        setLoading(true)

        // Simulate API call with timeout
        setTimeout(() => {
          // For now, just use the mock data
          setWorkflowData(mockWorkflows)

          // Set initial active section to first category
          const firstCategory = Object.keys(mockWorkflows)[0]
          if (firstCategory) {
            setActiveSection(firstCategory)
          }

          setLoading(false)

          // Automatically load workflow states for all workflows
          Object.values(mockWorkflows)
            .flat()
            .forEach((workflow) => {
              if (!workflow.workflowState) {
                fetchWorkflowState(workflow.id)
              }
            })
        }, 1500)
      } catch (error) {
        console.error('Error fetching workflows:', error)
        setError('Failed to load workflows. Please try again later.')
        setLoading(false)
      }
    }

    fetchWorkflows()
  }, [])

  // Function to fetch workflow state for a specific workflow
  const fetchWorkflowState = async (workflowId: string) => {
    try {
      // In a real implementation, this would be a fetch call to your API
      // For now, we'll just simulate it with the test state provided

      // Example API call:
      // const response = await fetch(`/api/workflows/${workflowId}/state`)
      // const data = await response.json()

      // Sample workflow states
      const sampleStates = {
        // First sample state
        state1: {
          blocks: {
            '69ff9f19-57fb-4544-9e9b-850bc4203cb3': {
              id: '69ff9f19-57fb-4544-9e9b-850bc4203cb3',
              type: 'starter',
              name: 'Start',
              position: {
                x: 100,
                y: 100,
              },
              subBlocks: {
                startWorkflow: {
                  id: 'startWorkflow',
                  type: 'dropdown',
                  value: 'manual',
                },
                webhookPath: {
                  id: 'webhookPath',
                  type: 'short-input',
                  value: '',
                },
                webhookSecret: {
                  id: 'webhookSecret',
                  type: 'short-input',
                  value: '',
                },
                scheduleType: {
                  id: 'scheduleType',
                  type: 'dropdown',
                  value: 'daily',
                },
                minutesInterval: {
                  id: 'minutesInterval',
                  type: 'short-input',
                  value: '',
                },
                minutesStartingAt: {
                  id: 'minutesStartingAt',
                  type: 'short-input',
                  value: '',
                },
                hourlyMinute: {
                  id: 'hourlyMinute',
                  type: 'short-input',
                  value: '',
                },
                dailyTime: {
                  id: 'dailyTime',
                  type: 'short-input',
                  value: '',
                },
                weeklyDay: {
                  id: 'weeklyDay',
                  type: 'dropdown',
                  value: 'MON',
                },
                weeklyDayTime: {
                  id: 'weeklyDayTime',
                  type: 'short-input',
                  value: '',
                },
                monthlyDay: {
                  id: 'monthlyDay',
                  type: 'short-input',
                  value: '',
                },
                monthlyTime: {
                  id: 'monthlyTime',
                  type: 'short-input',
                  value: '',
                },
                cronExpression: {
                  id: 'cronExpression',
                  type: 'short-input',
                  value: '',
                },
                timezone: {
                  id: 'timezone',
                  type: 'dropdown',
                  value: 'UTC',
                },
              },
              outputs: {
                response: {
                  type: {
                    input: 'any',
                  },
                },
              },
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 96,
            },
            'c43552ef-3b78-40be-98bd-b48d3620b3ca': {
              id: 'c43552ef-3b78-40be-98bd-b48d3620b3ca',
              type: 'exa',
              name: 'Exa 1',
              position: {
                x: 492.75,
                y: -192.30000000000013,
              },
              subBlocks: {
                operation: {
                  id: 'operation',
                  type: 'dropdown',
                  value: 'exa_get_contents',
                },
                query: {
                  id: 'query',
                  type: 'long-input',
                  value: null,
                },
                numResults: {
                  id: 'numResults',
                  type: 'short-input',
                  value: null,
                },
                useAutoprompt: {
                  id: 'useAutoprompt',
                  type: 'switch',
                  value: null,
                },
                type: {
                  id: 'type',
                  type: 'dropdown',
                  value: 'auto',
                },
                urls: {
                  id: 'urls',
                  type: 'long-input',
                  value: 'https://www.grainger.com/category',
                },
                text: {
                  id: 'text',
                  type: 'switch',
                  value: false,
                },
                summaryQuery: {
                  id: 'summaryQuery',
                  type: 'long-input',
                  value:
                    'Summarize the entire product catalog from Grainger (https://www.grainger.com/category?analytics=nav). \n\nExtract all product categories, subcategories, and product details by recursively navigating the category structure until individual products are reached.\n\nFor each product, extract the following structured information:\n- Product ID (Item Number)\n- Manufacturer Model Number\n- Product Name\n- Description\n- Full Category Hierarchy (to understand product classification)\n- Common Use Cases (real-world applications)\n- Technical Specifications (voltage, horsepower, size, weight, etc.)\n- Available Variations (dropdown-based SKU options)\n- Stock Availability\n- Price (if listed)\n- Brand\n- Product Image URLs\n- Product URL\n\nEnsure **all nested categories and paginated product listings are fully scraped**. Use **anti-bot techniques** (randomized headers, realistic User-Agent, and delays) to avoid detection.\n',
                },
                url: {
                  id: 'url',
                  type: 'long-input',
                  value: null,
                },
                apiKey: {
                  id: 'apiKey',
                  type: 'short-input',
                  value: '',
                },
              },
              outputs: {
                response: {
                  results: 'json',
                  similarLinks: 'json',
                  answer: 'string',
                  citations: 'json',
                },
              },
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 526,
            },
          },
          edges: [
            {
              id: '0b52741c-6c33-486d-90db-87b656b36e14',
              source: '69ff9f19-57fb-4544-9e9b-850bc4203cb3',
              target: 'c43552ef-3b78-40be-98bd-b48d3620b3ca',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
          loops: {},
          lastSaved: 1741238251762,
          isDeployed: false,
        },
        // Second sample state
        state2: {
          blocks: {
            '7ea690e9-40b7-433a-81f4-9c013bd908fc': {
              id: '7ea690e9-40b7-433a-81f4-9c013bd908fc',
              type: 'starter',
              name: 'Start',
              position: {
                x: 8.848492246438582,
                y: 65.25033924944911,
              },
              subBlocks: {
                startWorkflow: {
                  id: 'startWorkflow',
                  type: 'dropdown',
                  value: 'manual',
                },
                webhookPath: {
                  id: 'webhookPath',
                  type: 'short-input',
                  value: '',
                },
                webhookSecret: {
                  id: 'webhookSecret',
                  type: 'short-input',
                  value: '',
                },
                scheduleType: {
                  id: 'scheduleType',
                  type: 'dropdown',
                  value: 'daily',
                },
                minutesInterval: {
                  id: 'minutesInterval',
                  type: 'short-input',
                  value: '',
                },
                minutesStartingAt: {
                  id: 'minutesStartingAt',
                  type: 'short-input',
                  value: '',
                },
                hourlyMinute: {
                  id: 'hourlyMinute',
                  type: 'short-input',
                  value: '',
                },
                dailyTime: {
                  id: 'dailyTime',
                  type: 'short-input',
                  value: '',
                },
                weeklyDay: {
                  id: 'weeklyDay',
                  type: 'dropdown',
                  value: 'MON',
                },
                weeklyDayTime: {
                  id: 'weeklyDayTime',
                  type: 'short-input',
                  value: '',
                },
                monthlyDay: {
                  id: 'monthlyDay',
                  type: 'short-input',
                  value: '',
                },
                monthlyTime: {
                  id: 'monthlyTime',
                  type: 'short-input',
                  value: '',
                },
                cronExpression: {
                  id: 'cronExpression',
                  type: 'short-input',
                  value: '',
                },
                timezone: {
                  id: 'timezone',
                  type: 'dropdown',
                  value: 'UTC',
                },
              },
              outputs: {
                response: {
                  type: {
                    result: 'any',
                    stdout: 'string',
                    executionTime: 'number',
                  },
                },
              },
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 348,
            },
            '6512f898-7da6-4513-88d2-16d75f9e68be': {
              id: '6512f898-7da6-4513-88d2-16d75f9e68be',
              type: 'agent',
              name: 'Agent 1',
              position: {
                x: 593.8824178584484,
                y: -147.7026665650688,
              },
              subBlocks: {
                systemPrompt: {
                  id: 'systemPrompt',
                  type: 'long-input',
                  value: null,
                },
                context: {
                  id: 'context',
                  type: 'short-input',
                  value: null,
                },
                model: {
                  id: 'model',
                  type: 'dropdown',
                  value: null,
                },
                temperature: {
                  id: 'temperature',
                  type: 'slider',
                  value: null,
                },
                apiKey: {
                  id: 'apiKey',
                  type: 'short-input',
                  value: null,
                },
                tools: {
                  id: 'tools',
                  type: 'tool-input',
                  value: null,
                },
                responseFormat: {
                  id: 'responseFormat',
                  type: 'code',
                  value: null,
                },
              },
              outputs: {
                response: {
                  content: 'string',
                  model: 'string',
                  tokens: 'any',
                  toolCalls: 'any',
                },
              },
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 768,
            },
          },
          edges: [
            {
              id: '997ccd9f-7a89-460f-9208-e3b09cb82528',
              source: '7ea690e9-40b7-433a-81f4-9c013bd908fc',
              target: '6512f898-7da6-4513-88d2-16d75f9e68be',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
          loops: {},
        },
        // Original test state
        state3: {
          blocks: {
            '56367072-4db5-4772-a4d4-7cc6c39426c6': {
              id: '56367072-4db5-4772-a4d4-7cc6c39426c6',
              type: 'starter',
              name: 'Start',
              position: {
                x: -20,
                y: -84.61702910193597,
              },
              subBlocks: {
                startWorkflow: {
                  id: 'startWorkflow',
                  type: 'dropdown',
                  value: 'webhook',
                },
                webhookPath: {
                  id: 'webhookPath',
                  type: 'short-input',
                  value: '/188403',
                },
                webhookSecret: {
                  id: 'webhookSecret',
                  type: 'short-input',
                  value: '',
                },
                scheduleType: {
                  id: 'scheduleType',
                  type: 'dropdown',
                  value: 'daily',
                },
                minutesInterval: {
                  id: 'minutesInterval',
                  type: 'short-input',
                  value: '',
                },
                minutesStartingAt: {
                  id: 'minutesStartingAt',
                  type: 'short-input',
                  value: '',
                },
                hourlyMinute: {
                  id: 'hourlyMinute',
                  type: 'short-input',
                  value: '',
                },
                dailyTime: {
                  id: 'dailyTime',
                  type: 'short-input',
                  value: '',
                },
                weeklyDay: {
                  id: 'weeklyDay',
                  type: 'dropdown',
                  value: 'MON',
                },
                weeklyDayTime: {
                  id: 'weeklyDayTime',
                  type: 'short-input',
                  value: '',
                },
                monthlyDay: {
                  id: 'monthlyDay',
                  type: 'short-input',
                  value: '',
                },
                monthlyTime: {
                  id: 'monthlyTime',
                  type: 'short-input',
                  value: '',
                },
                cronExpression: {
                  id: 'cronExpression',
                  type: 'short-input',
                  value: '',
                },
                timezone: {
                  id: 'timezone',
                  type: 'dropdown',
                  value: 'UTC',
                },
              },
              outputs: {
                response: {
                  type: {
                    input: 'any',
                  },
                },
              },
              enabled: true,
              horizontalHandles: true,
              isWide: true,
              height: 427.8125,
            },
            'f92496b8-0bc0-4d55-bb24-d248d37eb46f': {
              id: 'f92496b8-0bc0-4d55-bb24-d248d37eb46f',
              type: 'jina',
              name: 'Jina 1',
              position: {
                x: 623.1435003505945,
                y: -38.2306610737525,
              },
              subBlocks: {
                url: {
                  id: 'url',
                  type: 'short-input',
                  value: 'amazon.com',
                },
                options: {
                  id: 'options',
                  type: 'checkbox-list',
                  value: null,
                },
                apiKey: {
                  id: 'apiKey',
                  type: 'short-input',
                  value: '{{JINA_API_KEY}}',
                },
              },
              outputs: {
                response: {
                  content: 'string',
                },
              },
              enabled: true,
              horizontalHandles: true,
              isWide: false,
              height: 307.84375,
            },
          },
          edges: [
            {
              id: 'f53a00be-6c87-4350-8ae3-e6e0896c20ce',
              source: '56367072-4db5-4772-a4d4-7cc6c39426c6',
              target: 'f92496b8-0bc0-4d55-bb24-d248d37eb46f',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
          loops: {},
          lastSaved: 1741381880349,
          isDeployed: false,
        },
      }

      // Choose a random state for demonstration
      const stateIndex = Math.floor(Math.random() * 3) + 1
      const stateKey = `state${stateIndex}` as keyof typeof sampleStates
      const testState = sampleStates[stateKey]

      // Update the workflow data with the state
      setWorkflowData((prevData) => {
        const updatedData = { ...prevData }

        // Update each category
        Object.keys(updatedData).forEach((category) => {
          updatedData[category] = updatedData[category].map((workflow) => {
            if (workflow.id === workflowId) {
              return { ...workflow, workflowState: testState }
            }
            return workflow
          })
        })

        return updatedData
      })
    } catch (error) {
      console.error(`Error fetching workflow state for ${workflowId}:`, error)
    }
  }

  // Filter workflows based on search query
  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) {
      return workflowData
    }

    const query = searchQuery.toLowerCase()
    const filtered: Record<string, Workflow[]> = {}

    Object.entries(workflowData).forEach(([category, workflows]) => {
      const matchingWorkflows = workflows.filter(
        (workflow) =>
          workflow.name.toLowerCase().includes(query) ||
          workflow.description.toLowerCase().includes(query) ||
          workflow.author.toLowerCase().includes(query) ||
          workflow.tags.some((tag) => tag.toLowerCase().includes(query))
      )

      if (matchingWorkflows.length > 0) {
        filtered[category] = matchingWorkflows
      }
    })

    return filtered
  }, [searchQuery, workflowData])

  // Function to scroll to a specific section
  const scrollToSection = (sectionId: string) => {
    if (sectionRefs.current[sectionId]) {
      sectionRefs.current[sectionId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  // Setup intersection observer to track active section
  useEffect(() => {
    // Function to get current section IDs in their display order
    const getCurrentSectionIds = () => {
      return Object.keys(filteredWorkflows).filter(
        (key) => filteredWorkflows[key] && filteredWorkflows[key].length > 0
      )
    }

    // Store current section positions for better tracking
    const sectionPositions: Record<string, DOMRect> = {}

    // Initial calculation of section positions
    const calculateSectionPositions = () => {
      Object.entries(sectionRefs.current).forEach(([id, ref]) => {
        if (ref) {
          sectionPositions[id] = ref.getBoundingClientRect()
        }
      })
    }

    // Debounce function to limit rapid position calculations
    const debounce = (fn: Function, delay: number) => {
      let timer: NodeJS.Timeout
      return function (...args: any[]) {
        clearTimeout(timer)
        timer = setTimeout(() => fn(...args), delay)
      }
    }

    // Calculate positions initially and on resize
    calculateSectionPositions()
    const debouncedCalculatePositions = debounce(calculateSectionPositions, 100)
    window.addEventListener('resize', debouncedCalculatePositions)

    // Use a single source of truth for determining the active section
    const determineActiveSection = () => {
      if (!contentRef.current) return

      const { scrollTop, scrollHeight, clientHeight } = contentRef.current
      const viewportTop = scrollTop
      const viewportMiddle = viewportTop + clientHeight / 2
      const viewportBottom = scrollTop + clientHeight
      const isAtBottom = viewportBottom >= scrollHeight - 50
      const isAtTop = viewportTop <= 20

      const currentSectionIds = getCurrentSectionIds()

      // Handle edge cases first
      if (isAtTop && currentSectionIds.length > 0) {
        setActiveSection(currentSectionIds[0])
        return
      }

      if (isAtBottom && currentSectionIds.length > 0) {
        setActiveSection(currentSectionIds[currentSectionIds.length - 1])
        return
      }

      // Find section whose position is closest to middle of viewport
      // This creates smoother transitions as we scroll
      let closestSection = null
      let closestDistance = Infinity

      Object.entries(sectionRefs.current).forEach(([id, ref]) => {
        if (!ref || !currentSectionIds.includes(id)) return

        const rect = ref.getBoundingClientRect()
        const sectionTop = rect.top + scrollTop - contentRef.current!.getBoundingClientRect().top
        const sectionMiddle = sectionTop + rect.height / 2
        const distance = Math.abs(viewportMiddle - sectionMiddle)

        if (distance < closestDistance) {
          closestDistance = distance
          closestSection = id
        }
      })

      if (closestSection) {
        setActiveSection(closestSection)
      }
    }

    // Use a passive scroll listener for smooth transitions
    const handleScroll = () => {
      // Using requestAnimationFrame ensures we only calculate
      // section positions during a paint frame, reducing jank
      window.requestAnimationFrame(determineActiveSection)
    }

    const contentElement = contentRef.current
    contentElement?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('resize', debouncedCalculatePositions)
      contentElement?.removeEventListener('scroll', handleScroll)
    }
  }, [loading, filteredWorkflows])

  return (
    <div className="flex flex-col h-[100vh]">
      {/* Control Bar */}
      <ControlBar setSearchQuery={setSearchQuery} />

      <div className="flex flex-1 overflow-hidden">
        {/* Toolbar */}
        <Toolbar scrollToSection={scrollToSection} activeSection={activeSection} />

        {/* Main content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto py-6 px-6 pb-16">
          {/* Error message */}
          <ErrorMessage message={error} />

          {/* Loading state */}
          {loading && (
            <>
              <Section
                id="loading"
                title="Popular"
                ref={(el) => {
                  sectionRefs.current['loading'] = el
                }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <WorkflowCardSkeleton key={`skeleton-${index}`} />
                  ))}
                </div>
              </Section>
            </>
          )}

          {/* Render workflow sections */}
          {!loading && (
            <>
              {Object.entries(filteredWorkflows).map(
                ([category, workflows]) =>
                  workflows.length > 0 && (
                    <Section
                      key={category}
                      id={category}
                      title={category}
                      ref={(el) => {
                        if (el) {
                          sectionRefs.current[category] = el
                        }
                      }}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {workflows.map((workflow, index) => (
                          <WorkflowCard
                            key={workflow.id}
                            workflow={workflow}
                            index={index}
                            onHover={fetchWorkflowState}
                          />
                        ))}
                      </div>
                    </Section>
                  )
              )}

              {Object.keys(filteredWorkflows).length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-64">
                  <AlertCircle className="h-8 w-8 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No workflows found matching your search.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
