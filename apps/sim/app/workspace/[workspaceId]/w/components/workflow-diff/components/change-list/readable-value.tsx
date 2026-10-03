import { ChipTag } from '@sim/emcn'
import { isRecordLike } from '@sim/utils/object'

interface ReadableValueProps {
  value: unknown
}

/** Nested domain values retain every property and ordered item without exposing JSON syntax. */
export function ReadableValue({ value }: ReadableValueProps) {
  if (Array.isArray(value)) {
    return value.length ? (
      <ol className='list-inside list-decimal space-y-2'>
        {value.map((item, index) => (
          <li key={index}>
            <ReadableValue value={item} />
          </li>
        ))}
      </ol>
    ) : (
      <span className='text-[var(--text-muted)]'>No items</span>
    )
  }
  if (isRecordLike(value)) {
    const entries = Object.entries(value)
    return entries.length ? (
      <dl className='space-y-2'>
        {entries.map(([key, entry]) => (
          <div key={key} className='grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] items-start gap-2'>
            <dt className='break-words text-[var(--text-muted)] text-caption'>{key}</dt>
            <dd className='min-w-0'>
              <ReadableValue value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <span className='text-[var(--text-muted)]'>No fields</span>
    )
  }
  if (value === undefined || value === null || value === '') {
    return (
      <span className='text-[var(--text-muted)] text-caption italic'>
        {value === undefined ? 'Unset' : value === null ? 'Null' : 'Empty'}
      </span>
    )
  }
  if (typeof value !== 'string') return <ChipTag variant='mono'>{String(value)}</ChipTag>
  return <span className='whitespace-pre-wrap break-words text-[var(--text-body)]'>{value}</span>
}
