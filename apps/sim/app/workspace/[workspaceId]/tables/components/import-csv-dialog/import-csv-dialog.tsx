'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  ChipCombobox,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  type ComboboxOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { CSV_ASYNC_IMPORT_THRESHOLD_BYTES } from '@/lib/table/constants'
import {
  buildAutoMapping,
  CSV_DELIMITER_SNIFF_BYTES,
  type CsvDelimiter,
  detectCsvDelimiter,
  parseCsvBuffer,
} from '@/lib/table/import'
import type { TableDefinition } from '@/lib/table/types'
import {
  type CsvImportMode,
  cancelTableJob,
  useImportCsvIntoTable,
  useImportCsvIntoTableAsync,
} from '@/hooks/queries/tables'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

const logger = createLogger('ImportCsvDialog')

const MAX_SAMPLE_ROWS = 5
const MAX_EXAMPLES_IN_ERROR = 3
/**
 * Bytes read for the preview/mapping. We never parse the whole file client-side — the importer
 * streams it server-side and the DB row-count trigger enforces the row limit.
 */
const CSV_PREVIEW_BYTES = 512 * 1024
/**
 * Sentinel value for the "Do not import" option in the mapping combobox. The
 * whitespace is intentional: valid column names must match `NAME_PATTERN`
 * (`/^[a-z_][a-z0-9_]*$/i`), so no real column can share this value.
 */
const SKIP_VALUE = '__ skip __'
/**
 * Sentinel for the "Create new column" option. Same whitespace trick as
 * `SKIP_VALUE` to avoid colliding with any valid column name.
 */
const CREATE_VALUE = '__ create __'

/**
 * Converts the verbose backend error messages into a short, human-friendly
 * summary suitable for the modal footer. Specifically collapses repeated
 * `Row N: Column "X" must be unique. Value "Y" already exists in row M`
 * segments into a single concise summary.
 */
function summarizeImportError(message: string): string {
  const uniqueMatches = [
    ...message.matchAll(/Column\s+"([^"]+)"\s+must be unique\.\s+Value\s+"([^"]+)"/g),
  ]
  if (uniqueMatches.length > 0) {
    const column = uniqueMatches[0][1]
    const values = Array.from(new Set(uniqueMatches.map((m) => m[2])))
    const preview = values
      .slice(0, MAX_EXAMPLES_IN_ERROR)
      .map((v) => `"${v}"`)
      .join(', ')
    const extra = values.length - MAX_EXAMPLES_IN_ERROR
    const suffix = extra > 0 ? `, +${extra} more` : ''
    return `${values.length} row${values.length === 1 ? '' : 's'} conflict on unique column "${column}" (${preview}${suffix})`
  }

  const requiredMatch = message.match(/missing required columns?:\s*(.+)/i)
  if (requiredMatch) {
    return `Missing required column(s): ${requiredMatch[1].replace(/[.;]+$/, '')}`
  }

  const rowLimitMatch = message.match(/row limit[^.;]*/i)
  if (rowLimitMatch) {
    return rowLimitMatch[0].trim()
  }

  const trimmed = message.trim()
  if (trimmed.length > 180) return truncate(trimmed, 177)
  return trimmed
}

interface ImportCsvDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  table: TableDefinition
  onImported?: (result: { insertedCount?: number; deletedCount?: number }) => void
}

interface ParsedCsv {
  file: File
  headers: string[]
  sampleRows: Record<string, unknown>[]
}

/**
 * Parses the head of a CSV/TSV for the mapping + sample, dropping any truncated final line.
 *
 * The separator is sniffed from the same leading bytes the server sniffs, so the mapping shown
 * here always matches the columns the import will actually produce.
 */
async function parseCsvPreview(file: File, fallbackDelimiter: CsvDelimiter) {
  const sliced = file.size > CSV_PREVIEW_BYTES
  const blob = sliced ? file.slice(0, CSV_PREVIEW_BYTES) : file
  let bytes = new Uint8Array(await blob.arrayBuffer())
  if (sliced) {
    const lastNewline = bytes.lastIndexOf(0x0a)
    if (lastNewline > 0) bytes = bytes.subarray(0, lastNewline + 1)
  }
  const delimiter = await detectCsvDelimiter(
    bytes.subarray(0, CSV_DELIMITER_SNIFF_BYTES),
    fallbackDelimiter
  )
  return parseCsvBuffer(bytes, delimiter)
}

export function ImportCsvDialog({
  open,
  onOpenChange,
  workspaceId,
  table,
  onImported,
}: ImportCsvDialogProps) {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [createHeaders, setCreateHeaders] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<CsvImportMode>('append')
  const importMutation = useImportCsvIntoTable()
  const importAsyncMutation = useImportCsvIntoTableAsync()

  function resetState() {
    setParsed(null)
    setParseError(null)
    setSubmitError(null)
    setMapping({})
    setCreateHeaders(new Set())
    setMode('append')
    setParsing(false)
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) resetState()
    onOpenChange(newOpen)
  }

  const prevTableIdRef = useRef(table.id)
  if (prevTableIdRef.current !== table.id) {
    prevTableIdRef.current = table.id
    resetState()
  }

  const columnOptions: ComboboxOption[] = useMemo(() => {
    const options: ComboboxOption[] = [
      { label: 'Do not import', value: SKIP_VALUE },
      { label: '+ Create new column', value: CREATE_VALUE },
    ]
    for (const col of table.schema.columns) {
      options.push({
        label: col.required ? `${col.name} (required)` : col.name,
        value: col.name,
      })
    }
    return options
  }, [table.schema.columns])

  async function handleFileSelected(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'tsv') {
      setParseError('Only CSV and TSV files are supported')
      return
    }
    setParsing(true)
    setParseError(null)
    try {
      const { headers, rows } = await parseCsvPreview(file, ext === 'tsv' ? '\t' : ',')
      const autoMapping = buildAutoMapping(headers, table.schema)
      setParsed({
        file,
        headers,
        sampleRows: rows.slice(0, MAX_SAMPLE_ROWS),
      })
      setMapping(autoMapping)
    } catch (err) {
      const message = getErrorMessage(err, 'Failed to parse CSV')
      logger.error('CSV parse failed', err)
      setParseError(message)
    } finally {
      setParsing(false)
    }
  }

  function handleFilesSelected(files: File[]) {
    const file = files[0]
    if (file) void handleFileSelected(file)
  }

  function handleMappingChange(header: string, value: string) {
    setSubmitError(null)
    if (value === CREATE_VALUE) {
      setCreateHeaders((prev) => {
        const next = new Set(prev)
        next.add(header)
        return next
      })
      setMapping((prev) => ({ ...prev, [header]: null }))
      return
    }
    setCreateHeaders((prev) => {
      if (!prev.has(header)) return prev
      const next = new Set(prev)
      next.delete(header)
      return next
    })
    setMapping((prev) => ({
      ...prev,
      [header]: value === SKIP_VALUE ? null : value,
    }))
  }

  function handleCreateAllUnmapped() {
    if (!parsed) return
    setSubmitError(null)
    setCreateHeaders((prev) => {
      const next = new Set(prev)
      for (const header of parsed.headers) {
        if (!mapping[header] && !next.has(header)) next.add(header)
      }
      return next
    })
  }

  function handleModeChange(value: string) {
    setSubmitError(null)
    setMode(value as CsvImportMode)
  }

  const { missingRequired, duplicateTargets, mappedCount, skipCount, createCount } = useMemo(() => {
    const mappedTargets = new Map<string, string[]>()
    let mapped = 0
    let skipped = 0
    let creating = 0
    for (const header of parsed?.headers ?? []) {
      if (createHeaders.has(header)) {
        creating++
        continue
      }
      const target = mapping[header]
      if (!target) {
        skipped++
        continue
      }
      mapped++
      const existing = mappedTargets.get(target) ?? []
      existing.push(header)
      mappedTargets.set(target, existing)
    }
    const dupes = [...mappedTargets.entries()]
      .filter(([, headers]) => headers.length > 1)
      .map(([col]) => col)
    const mappedSet = new Set(mappedTargets.keys())
    const missing = table.schema.columns
      .filter((c) => c.required && !mappedSet.has(c.name))
      .map((c) => c.name)
    return {
      missingRequired: missing,
      duplicateTargets: dupes,
      mappedCount: mapped,
      skipCount: skipped,
      createCount: creating,
    }
  }, [mapping, parsed?.headers, table.schema.columns, createHeaders])

  const canSubmit =
    parsed !== null &&
    !importMutation.isPending &&
    !importAsyncMutation.isPending &&
    missingRequired.length === 0 &&
    duplicateTargets.length === 0 &&
    mappedCount + createCount > 0

  async function handleSubmit() {
    if (!parsed || !canSubmit) return
    setSubmitError(null)
    const createColumns = createHeaders.size > 0 ? [...createHeaders] : undefined

    // Large files can't be POSTed through the server (request-body cap) — upload them
    // straight to storage and import in the background instead. Seed the header tray and
    // close the dialog immediately so the indicator is visible during the upload, then run
    // the upload + kickoff in the background (don't block the dialog on it).
    if (parsed.file.size >= CSV_ASYNC_IMPORT_THRESHOLD_BYTES) {
      useImportTrayStore.getState().startUpload({
        uploadId: table.id,
        workspaceId,
        title: parsed.file.name,
      })
      onOpenChange(false)
      toast.success(`Importing "${parsed.file.name}" into "${table.name}" in the background`)
      importAsyncMutation.mutate(
        {
          workspaceId,
          tableId: table.id,
          file: parsed.file,
          mode,
          mapping,
          createColumns,
          onProgress: (percent) => {
            useImportTrayStore.getState().setUploadPercent(table.id, percent)
          },
        },
        {
          onSuccess: (data) => {
            useImportTrayStore.getState().endUpload(table.id)
            // The server row drives the tray once the list refetches. If canceled mid-upload, flag
            // the id so it's not shown and cancel the worker server-side.
            if (useImportTrayStore.getState().consumeCanceled(table.id) && data?.importId) {
              useImportTrayStore.getState().cancel(table.id)
              void cancelTableJob(workspaceId, table.id, data.importId).catch(() => {})
            }
          },
          onError: () => {
            // The hook's onError surfaces the toast; just clear the tray indicator here.
            useImportTrayStore.getState().endUpload(table.id)
          },
        }
      )
      return
    }

    try {
      const result = await importMutation.mutateAsync({
        workspaceId,
        tableId: table.id,
        file: parsed.file,
        mode,
        mapping,
        createColumns,
      })
      const data = result.data
      if (mode === 'append') {
        toast.success(`Imported ${data?.insertedCount ?? 0} rows into "${table.name}"`)
      } else {
        toast.success(
          `Replaced rows in "${table.name}": deleted ${data?.deletedCount ?? 0}, inserted ${data?.insertedCount ?? 0}`
        )
      }
      onImported?.({
        insertedCount: data?.insertedCount,
        deletedCount: data?.deletedCount,
      })
      onOpenChange(false)
    } catch (err) {
      const message = getErrorMessage(err, 'Failed to import CSV')
      setSubmitError(summarizeImportError(message))
      logger.error('CSV import into existing table failed', err)
    }
  }

  const hasWarning = missingRequired.length > 0 || duplicateTargets.length > 0

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      srTitle={`Import CSV into ${table.name}`}
      size='lg'
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>
        Import CSV into {table.name}
      </ChipModalHeader>
      <ChipModalBody>
        {!parsed ? (
          <ChipModalField
            type='file'
            title='Import CSV'
            accept='.csv,.tsv'
            disabled={parsing}
            onChange={handleFilesSelected}
            label={parsing ? 'Parsing...' : 'Drop CSV or TSV here or click to browse'}
            description='Map columns to append or replace rows in this table'
            error={parseError ?? undefined}
          />
        ) : (
          <>
            <ChipModalField type='custom' title='File'>
              <div className='flex items-center justify-between gap-3 rounded-sm border border-[var(--border)] p-2'>
                <div className='flex min-w-0 flex-col'>
                  <span className='truncate text-[var(--text-primary)] text-caption'>
                    {parsed.file.name}
                  </span>
                  <span className='text-[var(--text-tertiary)] text-xs'>
                    {parsed.headers.length} columns
                  </span>
                </div>
                <Button variant='ghost' size='sm' onClick={resetState}>
                  Change file
                </Button>
              </div>
            </ChipModalField>

            <ChipModalField type='custom' title='Mode'>
              <ButtonGroup value={mode} onValueChange={handleModeChange}>
                <ButtonGroupItem value='append'>Append</ButtonGroupItem>
                <ButtonGroupItem value='replace'>Replace all rows</ButtonGroupItem>
              </ButtonGroup>
            </ChipModalField>

            <ChipModalField type='custom' title='Column mapping'>
              {skipCount > 0 && (
                <div className='flex justify-end'>
                  <Button variant='ghost' size='sm' onClick={handleCreateAllUnmapped}>
                    Create columns for {skipCount} unmapped
                  </Button>
                </div>
              )}
              <div className='overflow-hidden rounded-sm border border-[var(--border)]'>
                <div className='max-h-[320px] overflow-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CSV column</TableHead>
                        <TableHead>Target column</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsed.headers.map((header) => {
                        const sample = parsed.sampleRows
                          .map((r) =>
                            r[header] === '' || r[header] == null ? '' : String(r[header])
                          )
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(', ')
                        return (
                          <TableRow key={header}>
                            <TableCell>
                              <div className='flex min-w-0 flex-col'>
                                <span className='truncate text-[var(--text-primary)]'>
                                  {header}
                                </span>
                                {sample && (
                                  <span className='truncate text-[var(--text-tertiary)] text-xs'>
                                    {sample}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <ChipCombobox
                                options={columnOptions}
                                value={
                                  createHeaders.has(header)
                                    ? CREATE_VALUE
                                    : (mapping[header] ?? SKIP_VALUE)
                                }
                                onChange={(value) => handleMappingChange(header, value)}
                                className='w-full'
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <span className='text-[var(--text-tertiary)] text-xs'>
                {mappedCount} mapped
                {createCount > 0
                  ? ` · ${createCount} new column${createCount === 1 ? '' : 's'}`
                  : ''}
                {' · '}
                {skipCount} skipped
              </span>
            </ChipModalField>

            {missingRequired.length > 0 && (
              <ChipModalError>
                Missing required column(s): {missingRequired.join(', ')}
              </ChipModalError>
            )}
            {duplicateTargets.length > 0 && (
              <ChipModalError>
                Multiple CSV columns target: {duplicateTargets.join(', ')} (pick one)
              </ChipModalError>
            )}

            {mode === 'replace' && !hasWarning && (
              <ChipModalError>
                Replace will permanently delete the {table.rowCount.toLocaleString()} existing
                row(s) before inserting the new rows.
              </ChipModalError>
            )}

            <ChipModalError title={submitError ?? undefined}>{submitError}</ChipModalError>
          </>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={importMutation.isPending}
        primaryAction={{
          label: importMutation.isPending
            ? mode === 'replace'
              ? 'Replacing...'
              : 'Importing...'
            : mode === 'replace'
              ? 'Replace rows'
              : 'Append rows',
          onClick: handleSubmit,
          disabled: !canSubmit,
          variant: mode === 'replace' ? 'destructive' : 'primary',
        }}
      />
    </ChipModal>
  )
}
