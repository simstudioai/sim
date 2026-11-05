'use client'

import { useRef } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { SearchHistory } from '@/app/o/[organizationId]/_redesign/search/search-history'
import { SearchResults } from '@/app/o/[organizationId]/_redesign/search/search-results'
import styles from '@/app/o/[organizationId]/_redesign/search/search-surface.module.css'
import { SearchSurfaceHeader } from '@/app/o/[organizationId]/_redesign/search/search-surface-header'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SearchFrame } from '@/app/o/[organizationId]/search/search-frame'
import {
  useOrganizationSearch,
  useSearchFieldDraft,
} from '@/app/o/[organizationId]/search/use-organization-search'
import { VoiceWaveform } from '@/app/workspace/[workspaceId]/home/components/user-input/components/mic-button/mic-button'
import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'
import { useAutoSizeTextarea } from '@/hooks/use-auto-size-textarea'
import { IconButton } from '@/platform/design-system/components/button/button'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

const FIELD_MAX_HEIGHT_PX = 200

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
      <MicrophonePermissionHelp
        open={voice.permissionHelpOpen}
        onOpenChange={voice.setPermissionHelpOpen}
      />
    </>
  )
}

interface OrganizationSearchSurfaceProps {
  userId: string
  chatId?: string
}

function OrganizationSearchSurfaceContent({ userId, chatId }: OrganizationSearchSurfaceProps) {
  const { organization } = useOrganizationContext()
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
  return (
    <SearchFrame search={search} header={<SearchSurfaceHeader search={search} />}>
      <div className={styles.body}>
        <RedesignSurface>
          {query ? (
            <div className={styles.docked}>
              <div className={styles.dockedField}>{field}</div>
              <div ref={resultsScroll} className={styles.scroll}>
                <div className={styles.resultsColumn}>
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
                <h1 className={styles.heading} data-type='T076'>
                  Search {organization.name}
                </h1>
                <div className={styles.landingField}>{field}</div>
              </div>
            </div>
          )}
        </RedesignSurface>
      </div>
    </SearchFrame>
  )
}

/** Organization Search in the design system. The Assistant conversation renders beside it. */
export function OrganizationSearchSurface(props: OrganizationSearchSurfaceProps) {
  const { searchAccess } = useOrganizationContext()
  if (!searchAccess.memberScoped) return null
  return <OrganizationSearchSurfaceContent {...props} />
}
