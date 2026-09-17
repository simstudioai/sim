'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
import { ArrowUp, Search } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { organizationRoutes } from '@/lib/navigation/paths'
import { PAGE_COLUMN_CLASS } from '@/app/o/[organizationId]/components/organization-page'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSearchParsers,
  organizationSearchUrlKeys,
} from '@/app/o/[organizationId]/search/search-params'
import { KnowledgeSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
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
 * query field, centered like Home; once results arrive the field docks at
 * the top of the page — where every other organization page's title sits — and
 * the results scroll beneath it under the sidebar's edge fade. The submitted
 * query lives in the URL; the field holds the draft until the next submit.
 * Summarizing a document hands the turn to the Assistant on Home.
 */
export function OrganizationSearch() {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchContent />
}

function OrganizationSearchContent() {
  const { organization } = useOrganizationContext()
  const router = useRouter()
  const [{ q }, setParams] = useQueryStates(organizationSearchParsers, organizationSearchUrlKeys)
  const query = q.trim()
  const scope: ResourceScope = { kind: 'organization', organizationId: organization.id }

  const summarize = (message: string, assistantSearch: WorkspaceSearchFilters) => {
    MothershipHandoffStorage.store(
      { message, assistantSearch },
      { organizationId: organization.id }
    )
    router.push(organizationRoutes(organization.id).home)
  }

  const submit = (draft: string) => {
    const next = draft.trim()
    if (!next) return
    void setParams({ q: next })
  }

  const renderLayout = (results: ReactNode, docked: boolean) => (
    <SearchLayout query={q} onSubmit={submit} docked={docked}>
      {results}
    </SearchLayout>
  )

  return query ? (
    <KnowledgeSearchResults
      scope={scope}
      query={query}
      onSummarize={summarize}
      renderLayout={renderLayout}
    />
  ) : (
    renderLayout(null, false)
  )
}

interface SearchLayoutProps {
  query: string
  onSubmit: (draft: string) => void
  docked: boolean
  children: ReactNode
}

function SearchLayout({ query, onSubmit, docked, children }: SearchLayoutProps) {
  const { organization } = useOrganizationContext()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges(scrollContainerRef, { contentRef: scrollContentRef })

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER} />
      </div>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          !docked && 'overflow-y-auto [scrollbar-gutter:stable_both-edges]'
        )}
      >
        <div
          className={cn(
            'flex min-h-0 flex-col',
            docked ? 'flex-1' : 'min-h-full items-center justify-center px-6 pt-[2vh] pb-[22vh]'
          )}
        >
          <div
            className={cn(
              'shrink-0',
              docked
                ? cn(PAGE_COLUMN_CLASS, SIDEBAR_DIVIDER_PAD_ABOVE_CLASS, 'pt-8')
                : 'w-full max-w-chat'
            )}
          >
            {!docked && (
              <h1 className='mb-7 text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
                Search {organization.name}
              </h1>
            )}
            <SearchField
              key={query}
              initialValue={query}
              onSubmit={onSubmit}
              docked={docked}
              focusOnMount
            />
          </div>
          <div
            ref={scrollContainerRef}
            className={cn(
              docked
                ? cn(
                    SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
                    SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
                    scrollFadeClass,
                    'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'
                  )
                : 'w-full max-w-chat'
            )}
            {...scrollFadeAttributes(scrollEdges)}
          >
            <div ref={scrollContentRef} className={docked ? cn(PAGE_COLUMN_CLASS, 'px-8') : 'px-2'}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
