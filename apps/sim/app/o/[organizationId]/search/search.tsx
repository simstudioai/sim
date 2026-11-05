'use client'

import { Chip, ComposerActionButton } from '@sim/emcn'
import { ArrowUp, Plus, Search, Sparkles, StopFilled } from '@sim/emcn/icons'
import { HEADER_ACTION_CLUSTER } from '@/components/page-header-bar'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'
import { SearchLandingHistory } from '@/app/o/[organizationId]/components/search-landing-history'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchFrame } from '@/app/o/[organizationId]/search/search-frame'
import { SearchResultsView } from '@/app/o/[organizationId]/search/search-results-view'
import {
  useOrganizationSearch,
  useSearchFieldDraft,
} from '@/app/o/[organizationId]/search/use-organization-search'
import { MicButton } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'

const SEARCH_MODE_ICONS = { search: Search, assistant: Sparkles } as const

interface OrganizationSearchProps {
  userId: string
  chatId?: string
}

interface SearchFieldProps {
  userId: string
  initialValue: string
  onSubmit: (value: string) => void
}

function SearchField({ userId, initialValue, onSubmit }: SearchFieldProps) {
  const { organization } = useOrganizationContext()
  const {
    inputRef,
    hydrated,
    value,
    setValue,
    submit,
    voice,
    isSearching,
    canSubmit,
    submitOrStop,
  } = useSearchFieldDraft({ userId, initialValue, onSubmit })

  const field = (
    <SearchInputBar
      inputRef={inputRef}
      value={value}
      disabled={!hydrated}
      onChange={setValue}
      onSubmit={() => submit()}
      floating={!initialValue.trim()}
      voiceControl={
        voice.isSupported && (
          <MicButton
            audioLevels={voice.audioLevels}
            isListening={voice.isListening}
            onToggle={voice.toggleListening}
          />
        )
      }
      submitControl={
        <ComposerActionButton
          type='button'
          onClick={submitOrStop}
          disabled={!canSubmit && !isSearching}
          aria-label={isSearching ? 'Stop search' : 'Search'}
          aria-busy={isSearching}
          active={canSubmit || isSearching}
        >
          {isSearching ? (
            <StopFilled className='block size-[14px] fill-white dark:fill-black' />
          ) : (
            <ArrowUp className='block size-[16px] text-white dark:text-black' />
          )}
        </ComposerActionButton>
      }
    />
  )
  return (
    <>
      {!initialValue.trim() ? (
        <SearchLandingHistory
          organizationId={organization.id}
          userId={userId}
          onSearch={(query) => submit(query)}
        >
          {field}
        </SearchLandingHistory>
      ) : (
        field
      )}
      <MicrophonePermissionHelp
        open={voice.permissionHelpOpen}
        onOpenChange={voice.setPermissionHelpOpen}
      />
    </>
  )
}

/** Organization Search owns both document results and assistant conversations. */
export function OrganizationSearch(props: OrganizationSearchProps) {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchContent {...props} />
}

function OrganizationSearchContent({ userId, chatId }: OrganizationSearchProps) {
  const search = useOrganizationSearch({ userId, chatId })
  const { activeMode, query, newLabel } = search
  const header = (
    <>
      <nav aria-label='Search views' className={HEADER_ACTION_CLUSTER}>
        {search.modes.map((entry) => (
          <Chip
            key={entry.value}
            active={activeMode === entry.value}
            aria-current={activeMode === entry.value ? 'page' : undefined}
            leftIcon={SEARCH_MODE_ICONS[entry.value]}
            mobileCompact
            onClick={() => search.changeMode(entry.value)}
          >
            {entry.label}
          </Chip>
        ))}
      </nav>
      {search.canStartNew && (
        <Chip
          leftIcon={Plus}
          aria-label={newLabel}
          onClick={search.startNew}
          disabled={search.isStartingNew}
          mobileCompact
        >
          <span className='hidden md:inline'>{newLabel}</span>
          <span className='md:hidden'>New</span>
        </Chip>
      )}
    </>
  )
  return (
    <SearchFrame search={search} header={header}>
      <SearchResultsView
        composer={
          <SearchField key={query} userId={userId} initialValue={query} onSubmit={search.submit} />
        }
        query={query.trim()}
        onSummarize={search.summarize}
      />
    </SearchFrame>
  )
}
