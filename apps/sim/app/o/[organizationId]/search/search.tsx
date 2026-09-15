'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  ChipButtonGroup,
  ChipButtonGroupItem,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ArrowUp, Search } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { organizationRoutes } from '@/lib/navigation/paths'
import { PAGE_COLUMN_CLASS } from '@/app/o/[organizationId]/components/organization-page'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import {
  resourceUrlKeys,
  searchFilterParsers,
} from '@/app/workspace/[workspaceId]/home/search-params'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useVoiceInput } from '@/hooks/use-voice-input'

const SUBMIT_BUTTON_BASE = 'size-[28px] shrink-0 rounded-full border-0 p-0 transition-colors'
const SUBMIT_BUTTON_ACTIVE =
  'bg-[#383838] hover:bg-[#575757] dark:bg-[#E0E0E0] dark:hover:bg-[#CFCFCF]'
const SUBMIT_BUTTON_DISABLED = 'bg-[#808080] dark:bg-[#808080]'

interface SearchFieldProps {
  initialValue: string
  onSubmit: (value: string) => void
  /** Takes focus on mount so a query can be entered or refined immediately. */
  focusOnMount?: boolean
  /** Sitting at the page head over results, rather than floating in the hero. */
  docked?: boolean
}

/**
 * The query field: a single line in the pill the home composer's frame becomes,
 * with the composer's send control at its end. A search runs on that control or
 * on Enter, never as the viewer types. Like the composer, it carries the ambient
 * shadow only while it floats in the hero; docked at the page head it sits flat.
 */
function SearchField({
  initialValue,
  onSubmit,
  focusOnMount = false,
  docked = false,
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { organization } = useOrganizationContext()
  const [value, setValue] = useState(initialValue)
  const voice = useVoiceInput({
    organizationId: organization.id,
    getValue: () => value,
    onChange: setValue,
  })
  const canSubmit = value.trim().length > 0

  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus()
  }, [focusOnMount])

  return (
    <div
      className={cn(
        'flex h-[46px] w-full items-center gap-3 rounded-full border border-[var(--border-1)] bg-[var(--white)] pr-2.5 pl-4 dark:bg-[var(--surface-4)]',
        !docked && 'shadow-ambient'
      )}
    >
      <Search className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      <input
        ref={inputRef}
        type='search'
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSubmit(value)
          }
        }}
        placeholder='Search your sources'
        aria-label='Search your sources'
        autoComplete='off'
        spellCheck={false}
        className='h-full min-w-0 flex-1 bg-transparent font-body text-[14px] text-[var(--text-primary)] tracking-[-0.015em] outline-hidden placeholder:text-[var(--text-muted)] [&::-webkit-search-cancel-button]:hidden'
      />
      <div className='flex shrink-0 items-center gap-1.5'>
        {voice.isSupported && (
          <MicButton
            audioLevelsRef={voice.audioLevelsRef}
            isListening={voice.isListening}
            onToggle={voice.toggleListening}
          />
        )}
        <Button
          type='button'
          variant='ghost'
          onClick={() => onSubmit(value)}
          disabled={!canSubmit}
          aria-label='Search'
          className={cn(
            SUBMIT_BUTTON_BASE,
            canSubmit ? SUBMIT_BUTTON_ACTIVE : SUBMIT_BUTTON_DISABLED
          )}
        >
          <ArrowUp className='block size-[16px] text-white dark:text-black' />
        </Button>
      </div>
      <MicrophonePermissionHelp
        open={voice.permissionHelpOpen}
        onOpenChange={voice.setPermissionHelpOpen}
      />
    </div>
  )
}

/**
 * Sim Search over the organization's sources. Empty, it is the greeting over the
 * query field, centered like Home; once a query is submitted the field docks at
 * the top of the page — where every other organization page's title sits — and
 * the results scroll beneath it under the sidebar's edge fade. The submitted
 * query lives in the URL; the field holds the draft until the next submit.
 * Summarizing a document explicitly starts an Assistant turn in this Search surface.
 */
interface OrganizationSearchProps {
  chatId?: string
  userName?: string
}

export function OrganizationSearch(props: OrganizationSearchProps) {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchContent {...props} />
}

function OrganizationSearchContent({ chatId, userName }: OrganizationSearchProps) {
  const { organization } = useOrganizationContext()
  const router = useRouter()
  const [{ q, view }, setParams] = useQueryStates(
    organizationSearchParsers,
    organizationSearchUrlKeys
  )
  const [filters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const query = q.trim()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges(scrollContainerRef, { contentRef: scrollContentRef })

  const summarize = (message: string, assistantSearch: WorkspaceSearchFilters) => {
    MothershipHandoffStorage.store(
      { message, assistantSearch },
      { organizationId: organization.id }
    )
    void setParams({ view: 'assistant' })
  }

  const submit = (draft: string) => {
    const next = draft.trim()
    if (!next) return
    void setParams({ q: next })
  }

  const searching = query.length > 0
  const activeView = chatId ? 'assistant' : view

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      {/* Reserved even while empty so the field docks where the page header sits. */}
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER}>
          <ChipButtonGroup
            value={activeView}
            aria-label='Search view'
            onValueChange={(next) => {
              if (next !== 'results' && next !== 'assistant') return
              if (chatId) {
                router.push(
                  `${organizationRoutes(organization.id).search}?${new URLSearchParams({ ...(q ? { q } : {}), ...(filters.source ? { source: filters.source } : {}), ...(filters.updated !== 'any' ? { updated: filters.updated } : {}), ...(next === 'assistant' ? { view: next } : {}) })}`
                )
              } else {
                void setParams({ view: next })
              }
            }}
          >
            <ChipButtonGroupItem value='results'>Results</ChipButtonGroupItem>
            <ChipButtonGroupItem value='assistant'>Assistant</ChipButtonGroupItem>
          </ChipButtonGroup>
        </div>
      </div>
      {activeView === 'assistant' ? (
        <OrganizationHome requestMode='assistant' chatId={chatId} userName={userName} />
      ) : searching ? (
        <>
          <div className={cn(PAGE_COLUMN_CLASS, SIDEBAR_DIVIDER_PAD_ABOVE_CLASS, 'shrink-0 pt-8')}>
            <SearchField key={q} initialValue={q} onSubmit={submit} docked focusOnMount />
          </div>
          <div
            ref={scrollContainerRef}
            className={cn(
              SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
              SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
              scrollFadeClass,
              'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'
            )}
            {...scrollFadeAttributes(scrollEdges)}
          >
            {/* The rows carry their own `px-2`; this gutter brings each row's mark under the
                field's own search glyph, so results read as a column hanging from the field. */}
            <div ref={scrollContentRef} className={cn(PAGE_COLUMN_CLASS, 'px-8')}>
              <KnowledgeSearchResults scope={scope} query={query} onSummarize={summarize} />
            </div>
          </div>
        </>
      ) : (
        <div className='min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'>
          {/* Asymmetric padding biases the group up so heading and field sit at the optical center, as on Home */}
          <div className='flex min-h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[22vh]'>
            <h1 className='mb-7 max-w-chat text-balance font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
              Search {organization.name}
            </h1>
            <div className='w-full max-w-chat'>
              <SearchField key={q} initialValue={q} onSubmit={submit} focusOnMount />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
