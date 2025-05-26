'use client'

import {
  FileText,
  LibraryBig,
  Plus,
  Search,
  X,
  FileIcon,
  FileSpreadsheet,
  Info,
  Circle,
  CircleOff,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { format } from 'date-fns'
import { getDocumentIcon } from '@/app/w/knowledge/icons/document-icons'

interface KnowledgeBaseProps {
  id: string
}

// Helper function to get file icon based on mime type
function getFileIcon(mimeType: string, filename: string) {
  const IconComponent = getDocumentIcon(mimeType, filename)
  return <IconComponent className="w-5 h-6" />
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// Helper function to get status badge styles
function getStatusBadgeStyles(enabled: boolean) {
  return enabled
    ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
}

export function KnowledgeBase({ id }: KnowledgeBaseProps) {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(
    new Set()
  )
  const [documents, setDocuments] = useState(() => {
    // Sample data - in a real app, this would be fetched based on the ID
    const knowledgeBaseData = {
      'product-documentation': {
        title: 'Product Documentation',
        documents: [
          {
            id: 'doc-1',
            filename: 'getting-started-guide.pdf',
            mimeType: 'application/pdf',
            tokenCount: 5000,
            chunkCount: 12,
            uploadedAt: new Date('2025-05-20T10:30:00'),
            fileSize: 2457600, // 2.4 MB
            characterCount: 15000,
            enabled: true,
          },
          {
            id: 'doc-2',
            filename: 'api-reference.docx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            tokenCount: 15000,
            chunkCount: 35,
            uploadedAt: new Date('2025-05-19T14:20:00'),
            fileSize: 5242880, // 5 MB
            characterCount: 45000,
            enabled: true,
          },
          {
            id: 'doc-3',
            filename: 'integration-guides.pdf',
            mimeType: 'application/pdf',
            tokenCount: 10000,
            chunkCount: 24,
            uploadedAt: new Date('2025-05-18T09:15:00'),
            fileSize: 3145728, // 3 MB
            characterCount: 30000,
            enabled: false,
          },
          {
            id: 'doc-4',
            filename: 'best-practices.txt',
            mimeType: 'text/plain',
            tokenCount: 8000,
            chunkCount: 18,
            uploadedAt: new Date('2025-05-17T16:45:00'),
            fileSize: 102400, // 100 KB
            characterCount: 24000,
            enabled: true,
          },
        ],
      },
      'customer-support-faqs': {
        title: 'Customer Support FAQs',
        documents: [
          {
            id: 'faq-1',
            filename: 'account-management.pdf',
            mimeType: 'application/pdf',
            tokenCount: 3000,
            chunkCount: 8,
            uploadedAt: new Date('2025-05-21T11:00:00'),
            fileSize: 1048576, // 1 MB
            characterCount: 9000,
            enabled: true,
          },
          {
            id: 'faq-2',
            filename: 'billing-payments.docx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            tokenCount: 4000,
            chunkCount: 10,
            uploadedAt: new Date('2025-05-20T13:30:00'),
            fileSize: 2097152, // 2 MB
            characterCount: 12000,
            enabled: true,
          },
          {
            id: 'faq-3',
            filename: 'technical-issues.pdf',
            mimeType: 'application/pdf',
            tokenCount: 6000,
            chunkCount: 15,
            uploadedAt: new Date('2025-05-19T08:45:00'),
            fileSize: 1572864, // 1.5 MB
            characterCount: 18000,
            enabled: true,
          },
        ],
      },
      'internal-wiki': {
        title: 'Internal Wiki',
        documents: [
          {
            id: 'wiki-1',
            filename: 'company-policies.pdf',
            mimeType: 'application/pdf',
            tokenCount: 20000,
            chunkCount: 48,
            uploadedAt: new Date('2025-05-22T10:00:00'),
            fileSize: 10485760, // 10 MB
            characterCount: 60000,
            enabled: true,
          },
          {
            id: 'wiki-2',
            filename: 'development-standards.docx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            tokenCount: 15000,
            chunkCount: 36,
            uploadedAt: new Date('2025-05-21T15:20:00'),
            fileSize: 7340032, // 7 MB
            characterCount: 45000,
            enabled: true,
          },
          {
            id: 'wiki-3',
            filename: 'onboarding-guide.pdf',
            mimeType: 'application/pdf',
            tokenCount: 12000,
            chunkCount: 28,
            uploadedAt: new Date('2025-05-20T09:30:00'),
            fileSize: 4194304, // 4 MB
            characterCount: 36000,
            enabled: false,
          },
        ],
      },
      'research-papers': {
        title: 'Research Papers',
        documents: [
          {
            id: 'paper-1',
            filename: 'ml-model-performance.pdf',
            mimeType: 'application/pdf',
            tokenCount: 10000,
            chunkCount: 24,
            uploadedAt: new Date('2025-05-23T14:00:00'),
            fileSize: 3670016, // 3.5 MB
            characterCount: 30000,
            enabled: true,
          },
          {
            id: 'paper-2',
            filename: 'user-behavior-study.docx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            tokenCount: 8000,
            chunkCount: 19,
            uploadedAt: new Date('2025-05-22T11:30:00'),
            fileSize: 2621440, // 2.5 MB
            characterCount: 24000,
            enabled: true,
          },
        ],
      },
    }

    const currentBase = knowledgeBaseData[
      id as keyof typeof knowledgeBaseData
    ] || {
      title: 'Unknown Knowledge Base',
      documents: [],
    }

    return currentBase
  })

  // Filter documents based on search query
  const filteredDocuments = documents.documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleToggleEnabled = (docId: string) => {
    setDocuments((prev) => ({
      ...prev,
      documents: prev.documents.map((doc) =>
        doc.id === docId ? { ...doc, enabled: !doc.enabled } : doc
      ),
    }))
  }

  const handleDeleteDocument = (docId: string) => {
    setDocuments((prev) => ({
      ...prev,
      documents: prev.documents.filter((doc) => doc.id !== docId),
    }))
  }

  const handleSelectDocument = (docId: string, checked: boolean) => {
    setSelectedDocuments((prev) => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(docId)
      } else {
        newSet.delete(docId)
      }
      return newSet
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedDocuments(new Set(filteredDocuments.map((doc) => doc.id)))
    } else {
      setSelectedDocuments(new Set())
    }
  }

  const isAllSelected =
    filteredDocuments.length > 0 &&
    selectedDocuments.size === filteredDocuments.length
  const isIndeterminate =
    selectedDocuments.size > 0 &&
    selectedDocuments.size < filteredDocuments.length

  return (
    <div
      className={`flex h-[100vh] flex-col transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      {/* Fixed Header with Breadcrumbs */}
      <div className="flex items-center gap-2 px-6 pt-[14px] pb-6">
        <Link
          href="/w/knowledge"
          prefetch={true}
          className="flex items-center gap-2 font-medium text-sm hover:text-muted-foreground transition-colors group"
        >
          <LibraryBig className="h-[18px] w-[18px] text-muted-foreground group-hover:text-muted-foreground/70 transition-colors" />
          <span>Knowledge</span>
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium text-sm">{documents.title}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Main Content */}
          <div className="flex-1 overflow-auto pt-[4px]">
            <div className="px-6 pb-6">
              {/* Search and Create Section */}
              <div className="flex items-center justify-between mb-4">
                <div className="relative flex-1 max-w-md">
                  <div className="relative flex items-center">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-[18px] w-[18px] text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search documents..."
                      className="h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-[18px] w-[18px]" />
                      </button>
                    )}
                  </div>
                </div>

                <button className="flex items-center gap-1 px-3 py-[7px] bg-[#701FFC] text-primary-foreground rounded-md shadow-[0_0_0_0_#701FFC] hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] transition-all duration-200 text-sm font-[480]">
                  <Plus className="w-4 h-4 font-[480]" />
                  <span>Add Document</span>
                </button>
              </div>

              {/* Table container */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Table header - fixed */}
                <div className="sticky top-0 z-10 border-b bg-background">
                  <table className="w-full table-fixed">
                    <colgroup>
                      <col className="w-[5%]" />
                      <col
                        className={`${isSidebarCollapsed ? 'w-[18%]' : 'w-[20%]'}`}
                      />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="hidden w-[8%] lg:table-column" />
                      <col
                        className={`${isSidebarCollapsed ? 'w-[22%]' : 'w-[20%]'}`}
                      />
                      <col className="w-[10%]" />
                      <col className="w-[16%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={handleSelectAll}
                            aria-label="Select all documents"
                            className="h-3.5 w-3.5 border-gray-300 data-[state=checked]:bg-[#701FFC] data-[state=checked]:border-[#701FFC] focus-visible:ring-[#701FFC]/20 [&>*]:h-3 [&>*]:w-3"
                          />
                        </th>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <span className="text-muted-foreground text-xs leading-none">
                            Name
                          </span>
                        </th>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <span className="text-muted-foreground text-xs leading-none">
                            Size
                          </span>
                        </th>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <span className="text-muted-foreground text-xs leading-none">
                            Tokens
                          </span>
                        </th>
                        <th className="hidden px-4 pt-2 pb-3 text-left font-medium lg:table-cell">
                          <span className="text-muted-foreground text-xs leading-none">
                            Chunks
                          </span>
                        </th>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <span className="text-muted-foreground text-xs leading-none">
                            Uploaded
                          </span>
                        </th>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <span className="text-muted-foreground text-xs leading-none">
                            Status
                          </span>
                        </th>
                        <th className="px-4 pt-2 pb-3 text-left font-medium">
                          <span className="text-muted-foreground text-xs leading-none">
                            Actions
                          </span>
                        </th>
                      </tr>
                    </thead>
                  </table>
                </div>

                {/* Table body - scrollable */}
                <div className="flex-1 overflow-auto">
                  <table className="w-full table-fixed">
                    <colgroup>
                      <col className="w-[5%]" />
                      <col
                        className={`${isSidebarCollapsed ? 'w-[18%]' : 'w-[20%]'}`}
                      />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="hidden w-[8%] lg:table-column" />
                      <col
                        className={`${isSidebarCollapsed ? 'w-[22%]' : 'w-[20%]'}`}
                      />
                      <col className="w-[10%]" />
                      <col className="w-[16%]" />
                    </colgroup>
                    <tbody>
                      {filteredDocuments.length === 0 ? (
                        <tr className="border-b transition-colors hover:bg-accent/30">
                          {/* Select column */}
                          <td className="px-4 py-3">
                            <div className="h-3.5 w-3.5" />
                          </td>

                          {/* Name column */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <FileText className="w-5 h-6 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground italic">
                                No documents yet
                              </span>
                            </div>
                          </td>

                          {/* Size column */}
                          <td className="px-4 py-3">
                            <div className="text-muted-foreground text-xs">
                              —
                            </div>
                          </td>

                          {/* Tokens column */}
                          <td className="px-4 py-3">
                            <div className="text-xs text-muted-foreground">
                              —
                            </div>
                          </td>

                          {/* Chunks column - hidden on small screens */}
                          <td className="hidden px-4 py-3 lg:table-cell">
                            <div className="text-muted-foreground text-xs">
                              —
                            </div>
                          </td>

                          {/* Upload Time column */}
                          <td className="px-4 py-3">
                            <div className="text-muted-foreground text-xs">
                              —
                            </div>
                          </td>

                          {/* Status column */}
                          <td className="px-4 py-3">
                            <div className="text-muted-foreground text-xs">
                              —
                            </div>
                          </td>

                          {/* Actions column */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                // TODO: Open add document modal when implemented
                                console.log('Add document clicked')
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-[#701FFC] text-primary-foreground rounded-md text-xs font-medium hover:bg-[#6518E6] transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Document</span>
                            </button>
                          </td>
                        </tr>
                      ) : (
                        filteredDocuments.map((doc, index) => (
                          <tr
                            key={doc.id}
                            className="cursor-pointer border-b transition-colors hover:bg-accent/30"
                          >
                            {/* Select column */}
                            <td className="px-4 py-3">
                              <Checkbox
                                checked={selectedDocuments.has(doc.id)}
                                onCheckedChange={(checked) =>
                                  handleSelectDocument(
                                    doc.id,
                                    checked as boolean
                                  )
                                }
                                aria-label={`Select ${doc.filename}`}
                                className="h-3.5 w-3.5 border-gray-300 data-[state=checked]:bg-[#701FFC] data-[state=checked]:border-[#701FFC] focus-visible:ring-[#701FFC]/20 [&>*]:h-3 [&>*]:w-3"
                              />
                            </td>

                            {/* Name column */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {getFileIcon(doc.mimeType, doc.filename)}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className="text-sm truncate block"
                                      title={doc.filename}
                                    >
                                      {doc.filename}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    {doc.filename}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </td>

                            {/* Size column */}
                            <td className="px-4 py-3">
                              <div className="text-muted-foreground text-xs">
                                {formatFileSize(doc.fileSize)}
                              </div>
                            </td>

                            {/* Tokens column */}
                            <td className="px-4 py-3">
                              <div className="text-xs">
                                {(doc.tokenCount / 1000).toFixed(1)}k
                              </div>
                            </td>

                            {/* Chunks column - hidden on small screens */}
                            <td className="hidden px-4 py-3 lg:table-cell">
                              <div className="text-muted-foreground text-xs">
                                {doc.chunkCount}
                              </div>
                            </td>

                            {/* Upload Time column */}
                            <td className="px-4 py-3">
                              <div className="flex flex-col justify-center">
                                <div className="flex items-center font-medium text-xs">
                                  <span>
                                    {format(doc.uploadedAt, 'h:mm a')}
                                  </span>
                                  <span className="mx-1.5 hidden text-muted-foreground xl:inline">
                                    •
                                  </span>
                                  <span className="hidden text-muted-foreground xl:inline">
                                    {format(doc.uploadedAt, 'MMM d, yyyy')}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-muted-foreground text-xs lg:hidden">
                                  {format(doc.uploadedAt, 'MMM d')}
                                </div>
                              </div>
                            </td>

                            {/* Status column */}
                            <td className="px-4 py-3">
                              <div
                                className={`inline-flex items-center justify-center rounded-md px-2 py-1 text-xs ${getStatusBadgeStyles(doc.enabled)}`}
                              >
                                <span className="font-medium">
                                  {doc.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                            </td>

                            {/* Actions column */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleToggleEnabled(doc.id)
                                      }
                                      className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700"
                                    >
                                      {doc.enabled ? (
                                        <Circle className="h-4 w-4" />
                                      ) : (
                                        <CircleOff className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    {doc.enabled
                                      ? 'Disable Document'
                                      : 'Enable Document'}
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        handleDeleteDocument(doc.id)
                                      }
                                      className="h-8 w-8 p-0 text-gray-500 hover:text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    Delete Document
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
