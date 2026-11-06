'use client'

import { lazy, Suspense, useRef } from 'react'
import { useOrganization } from '@/lib/organizations/provider'
import { SearchFrame } from '@/app/o/[organizationId]/search/search-frame'
import { VoiceWaveform } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { useAutoSizeTextarea } from '@/hooks/use-auto-size-textarea'
import { IconButton } from '@/platform/design-system/components/button/button'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { Surface } from '@/platform/design-system/components/surface/surface'
import conversationStyles from '@/platform/embedded/app/(shell)/_components/conversation/conversation.module.css'
import { MicrophoneHelp } from '@/platform/embedded/app/(shell)/_components/conversation/dialogs'
import { ConversationLanding } from '@/platform/embedded/app/(shell)/_components/conversation/landing'
import {
  ConversationSkeleton,
  LandingSkeleton,
} from '@/platform/embedded/app/(shell)/_components/conversation/skeletons'
import { SearchResults } from '@/platform/embedded/app/(shell)/_components/search/search-results'
import { GetStarted } from '@/platform/embedded/app/(shell)/home/_components/get-started/get-started'
import { SearchHistory } from '@/platform/embedded/app/(shell)/search/_components/search-surface/search-history'
import styles from '@/platform/embedded/app/(shell)/search/_components/search-surface/search-surface.module.css'
import { SearchSurfaceHeader } from '@/platform/embedded/app/(shell)/search/_components/search-surface/search-surface-header'
import { useGetStartedSteps } from '@/platform/embedded/lib/data/get-started'
import {
  useOrganizationSearch,
  useSearchFieldDraft,
} from '@/platform/embedded/lib/data/organization-search'

const FIELD_MAX_HEIGHT_PX = 200

const PageConversation = lazy(() =>
  import('@/platform/embedded/app/(shell)/_components/conversation/page-conversation').then(
    (module) => ({
      default: module.PageConversation,
    })
  )
)

interface SearchFieldProps {
  userId: string
  initialValue: string
  onSubmit: (value: string) => void
}

function SearchField({ userId, initialValue, onSubmit }: SearchFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null)
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
  useAutoSizeTextarea({
    textareaRef: inputRef,
    scrollerRef: fieldRef,
    value,
    maxHeight: FIELD_MAX_HEIGHT_PX,
  })
  const landing = !initialValue.trim()
  const voiceLabel = voice.isListening ? 'Stop listening' : 'Voice input'
  const field = (
    <div
      ref={fieldRef}
      className={styles.field}
      data-material='reading'
      data-elevation={landing ? 'composer' : undefined}
    >
      <span className={styles.fieldMark}>
        <Icon name='I089' />
      </span>
      <textarea
        ref={inputRef}
        className={styles.input}
        data-type='T048'
        rows={1}
        value={value}
        disabled={!hydrated}
        placeholder='Search your sources'
        aria-label='Search your sources'
        autoComplete='off'
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {voice.isSupported && (
        <IconButton
          tooltip
          label={voiceLabel}
          icon='I083'
          onClick={voice.toggleListening}
          render={
            voice.isListening ? (
              <button type='button' aria-pressed>
                <VoiceWaveform audioLevels={voice.audioLevels} isListening />
              </button>
            ) : (
              <button type='button' aria-pressed={false} />
            )
          }
        />
      )}
      <IconButton
        variant='solid'
        label={isSearching ? 'Stop search' : 'Search'}
        icon={isSearching ? 'I035' : 'I023'}
        disabled={!canSubmit && !isSearching}
        render={<button type='button' aria-busy={isSearching} />}
        onClick={submitOrStop}
      />
    </div>
  )
  return (
    <>
      {landing ? (
        <SearchHistory userId={userId} onSearch={(query) => submit(query)}>
          {field}
        </SearchHistory>
      ) : (
        field
      )}
      {voice.permissionHelpOpen && (
        <MicrophoneHelp onClose={() => voice.setPermissionHelpOpen(false)} />
      )}
    </>
  )
}

/** Its own surface, because the composer above it is legacy. */
function AssistantGetStarted() {
  const steps = useGetStartedSteps()
  if (steps.length === 0) return null
  return (
    <div className={conversationStyles.landingGetStarted}>
      <Surface>
        <GetStarted steps={steps} />
      </Surface>
    </div>
  )
}

interface OrganizationSearchSurfaceProps {
  userId: string
  chatId?: string
}

function OrganizationSearchSurfaceContent({ userId, chatId }: OrganizationSearchSurfaceProps) {
  const { organization } = useOrganization()
  const search = useOrganizationSearch({ userId, chatId })
  const query = search.query.trim()
  const resultsScroll = useScrollEdges<HTMLDivElement>()
  const field = (
    <SearchField
      key={search.query}
      userId={userId}
      initialValue={search.query}
      onSubmit={search.submit}
    />
  )
  const header = <SearchSurfaceHeader search={search} />
  const assistantFallback = search.chatId ? (
    <ConversationSkeleton header={header} />
  ) : (
    <LandingSkeleton field='composer' header={header} />
  )
  return (
    <SearchFrame
      search={search}
      header={header}
      unresolvedFallback={<LandingSkeleton field='search' />}
      assistant={
        <Suspense fallback={assistantFallback}>
          <PageConversation
            key={search.conversationInstance}
            requestMode='assistant'
            chatId={search.chatId}
            header={header}
            active={search.activeMode === 'assistant'}
            summaryRequest={search.pendingSummary}
            onSummaryConsumed={search.consumeSummary}
            fallback={assistantFallback}
            landing={({ composer }) => (
              <ConversationLanding heading={`Ask ${organization.name}`}>
                {composer}
                <AssistantGetStarted />
              </ConversationLanding>
            )}
          />
        </Suspense>
      }
    >
      <main className={styles.body}>
        <Surface>
          {query ? (
            <div className={styles.docked}>
              <div className={styles.dockedRow}>
                <div className={`${styles.column} ${styles.dockedField}`}>{field}</div>
              </div>
              <div ref={resultsScroll} className={styles.scroll}>
                <div className={`${styles.column} ${styles.resultsColumn}`}>
                  <SearchResults
                    scope={{ kind: 'organization', organizationId: organization.id }}
                    query={query}
                    onSummarize={search.summarize}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.scroll}>
              <div className={styles.landing}>
                <div className={styles.column}>
                  <h1 className={conversationStyles.landingHeading} data-type='T076'>
                    Search {organization.name}
                  </h1>
                  {field}
                </div>
              </div>
            </div>
          )}
        </Surface>
      </main>
    </SearchFrame>
  )
}

/** Organization Search in the design system. The Assistant conversation renders beside it. */
export function OrganizationSearchSurface(props: OrganizationSearchSurfaceProps) {
  const { searchAccess } = useOrganization()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchSurfaceContent {...props} />
}
