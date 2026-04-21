'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Combobox,
  type ComboboxOption,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { buildAutoMapping, parseCsvBuffer } from '@/lib/table/csv-import'
import type { TableDefinition } from '@/lib/table/types'
import { type CsvImportMode, useImportCsvIntoTable } from '@/hooks/queries/tables'

const logger = createLogger('ImportCsvDialog')

const MAX_SAMPLE_ROWS = 5
const MAX_EXAMPLES_IN_ERROR = 3
/**
 * Sentinel value for the "Do not import" option in the mapping combobox. The
 * whitespace is intentional: valid column names must match `NAME_PATTERN`
 * (`/^[a-z_][a-z0-9_]*$/i`), so no real column can share this value.
 */
const SKIP_VALUE = '__ skip __'

/**
 * Converts the verbose backend error messages into a short, human-friendly
 * summary suitable for the modal footer. Specifically collapses repeated
 * `Row N: Column "X" must be unique. Value "Y" already exists in row row_abc`
 * segments into a single concise summary without internal row IDs.
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

  const stripped = message.replace(/\s+in row\s+row_[a-f0-9]+/gi, '').trim()
  if (stripped.length > 180) return `${stripped.slice(0, 177)}...`
  return stripped
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
  totalRows: number
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
  const [mode, setMode] = useState<CsvImportMode>('append')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importMutation = useImportCsvIntoTable()

  const resetState = useCallback(() => {
    setParsed(null)
    setParseError(null)
    setSubmitError(null)
    setMapping({})
    setMode('append')
    setIsDragging(false)
    setParsing(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  useEffect(() => {
    if (!open) resetState()
  }, [open, resetState])

  useEffect(() => {
    resetState()
  }, [table.id, resetState])

  const columnOptions: ComboboxOption[] = useMemo(() => {
    const options: ComboboxOption[] = [{ label: 'Do not import', value: SKIP_VALUE }]
    for (const col of table.schema.columns) {
      options.push({
        label: col.required ? `${col.name} (required)` : col.name,
        value: col.name,
      })
    }
    return options
  }, [table.schema.columns])

  const handleFileSelected = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext !== 'csv' && ext !== 'tsv') {
        setParseError('Only CSV and TSV files are supported')
        return
      }
      setParsing(true)
      setParseError(null)
      try {
        const arrayBuffer = await file.arrayBuffer()
        const delimiter = ext === 'tsv' ? '\t' : ','
        const { headers, rows } = await parseCsvBuffer(new Uint8Array(arrayBuffer), delimiter)
        const autoMapping = buildAutoMapping(headers, table.schema)
        setParsed({
          file,
          headers,
          sampleRows: rows.slice(0, MAX_SAMPLE_ROWS),
          totalRows: rows.length,
        })
        setMapping(autoMapping)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to parse CSV'
        logger.error('CSV parse failed', err)
        setParseError(message)
      } finally {
        setParsing(false)
      }
    },
    [table.schema]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleFileSelected(file)
    },
    [handleFileSelected]
  )

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFileSelected(file)
    },
    [handleFileSelected]
  )

  const handleMappingChange = useCallback((header: string, value: string) => {
    setSubmitError(null)
    setMapping((prev) => ({
      ...prev,
      [header]: value === SKIP_VALUE ? null : value,
    }))
  }, [])

  const handleModeChange = useCallback((value: string) => {
    setSubmitError(null)
    setMode(value as CsvImportMode)
  }, [])

  const { missingRequired, duplicateTargets, mappedCount, skipCount } = useMemo(() => {
    const mappedTargets = new Map<string, string[]>()
    let mapped = 0
    let skipped = 0
    for (const header of parsed?.headers ?? []) {
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
    }
  }, [mapping, parsed?.headers, table.schema.columns])

  const appendCapacityDeficit =
    parsed && mode === 'append' && table.rowCount + parsed.totalRows > table.maxRows
      ? table.rowCount + parsed.totalRows - table.maxRows
      : 0

  const replaceCapacityDeficit =
    parsed && mode === 'replace' && parsed.totalRows > table.maxRows
      ? parsed.totalRows - table.maxRows
      : 0

  const canSubmit =
    parsed !== null &&
    !importMutation.isPending &&
    missingRequired.length === 0 &&
    duplicateTargets.length === 0 &&
    mappedCount > 0 &&
    appendCapacityDeficit === 0 &&
    replaceCapacityDeficit === 0

  const handleSubmit = useCallback(async () => {
    if (!parsed || !canSubmit) return
    setSubmitError(null)
    try {
      const result = await importMutation.mutateAsync({
        workspaceId,
        tableId: table.id,
        file: parsed.file,
        mode,
        mapping,
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
      const message = err instanceof Error ? err.message : 'Failed to import CSV'
      setSubmitError(summarizeImportError(message))
      logger.error('CSV import into existing table failed', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canSubmit,
    mapping,
    mode,
    onImported,
    onOpenChange,
    parsed,
    table.id,
    table.name,
    workspaceId,
  ])

  const hasWarning =
    missingRequired.length > 0 ||
    duplicateTargets.length > 0 ||
    appendCapacityDeficit > 0 ||
    replaceCapacityDeficit > 0

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='lg'>
        <ModalHeader>Import CSV into {table.name}</ModalHeader>
        <ModalBody>
          {!parsed ? (
            <div className='flex flex-col gap-2'>
              <Label>Upload CSV</Label>
              <Button
                type='button'
                variant='default'
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                disabled={parsing}
                className={cn(
                  '!bg-[var(--surface-1)] hover-hover:!bg-[var(--surface-4)] w-full justify-center border border-[var(--border-1)] border-dashed py-2.5',
                  isDragging && 'border-[var(--surface-7)]'
                )}
              >
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='.csv,.tsv'
                  onChange={handleFileInputChange}
                  className='hidden'
                />
                <div className='flex flex-col gap-0.5 text-center'>
                  <span className='text-[var(--text-primary)]'>
                    {parsing
                      ? 'Parsing...'
                      : isDragging
                        ? 'Drop file here'
                        : 'Drop CSV or TSV here or click to browse'}
                  </span>
                  <span className='text-[var(--text-tertiary)] text-xs'>
                    Map columns to append or replace rows in this table
                  </span>
                </div>
              </Button>
              {parseError && (
                <p className='text-[var(--text-error)] text-caption leading-tight'>{parseError}</p>
              )}
            </div>
          ) : (
            <div className='flex flex-col gap-4'>
              <div className='flex items-center justify-between gap-3 rounded-sm border border-[var(--border)] p-2'>
                <div className='flex min-w-0 flex-col'>
                  <span className='truncate text-[var(--text-primary)] text-caption'>
                    {parsed.file.name}
                  </span>
                  <span className='text-[var(--text-tertiary)] text-xs'>
                    {parsed.totalRows.toLocaleString()} rows · {parsed.headers.length} columns
                  </span>
                </div>
                <Button variant='ghost' size='sm' onClick={resetState}>
                  Change file
                </Button>
              </div>

              <div className='flex flex-col gap-2'>
                <Label>Mode</Label>
                <ButtonGroup value={mode} onValueChange={handleModeChange}>
                  <ButtonGroupItem value='append'>Append</ButtonGroupItem>
                  <ButtonGroupItem value='replace'>Replace all rows</ButtonGroupItem>
                </ButtonGroup>
              </div>

              <div className='flex flex-col gap-2'>
                <Label>Column mapping</Label>
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
                                <Combobox
                                  options={columnOptions}
                                  value={mapping[header] ?? SKIP_VALUE}
                                  onChange={(value) => handleMappingChange(header, value)}
                                  size='sm'
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
                  {mappedCount} mapped · {skipCount} skipped
                </span>
              </div>

              {hasWarning && (
                <div className='flex flex-col gap-1'>
                  {missingRequired.length > 0 && (
                    <p className='text-[var(--text-error)] text-caption leading-tight'>
                      Missing required column(s): {missingRequired.join(', ')}
                    </p>
                  )}
                  {duplicateTargets.length > 0 && (
                    <p className='text-[var(--text-error)] text-caption leading-tight'>
                      Multiple CSV columns target: {duplicateTargets.join(', ')} (pick one)
                    </p>
                  )}
                  {appendCapacityDeficit > 0 && (
                    <p className='text-[var(--text-error)] text-caption leading-tight'>
                      Append would exceed the row limit ({table.maxRows.toLocaleString()}) by{' '}
                      {appendCapacityDeficit.toLocaleString()} row(s). Remove rows or switch to
                      Replace.
                    </p>
                  )}
                  {replaceCapacityDeficit > 0 && (
                    <p className='text-[var(--text-error)] text-caption leading-tight'>
                      CSV has {parsed.totalRows.toLocaleString()} rows, which exceeds the table
                      limit of {table.maxRows.toLocaleString()} by{' '}
                      {replaceCapacityDeficit.toLocaleString()}.
                    </p>
                  )}
                </div>
              )}

              {mode === 'replace' && !hasWarning && (
                <p className='text-[var(--text-error)] text-caption leading-tight'>
                  Replace will permanently delete the {table.rowCount.toLocaleString()} existing
                  row(s) before inserting the new rows.
                </p>
              )}

              {submitError && (
                <p
                  className='text-[var(--text-error)] text-caption leading-tight'
                  title={submitError}
                >
                  {submitError}
                </p>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant='default'
            onClick={() => onOpenChange(false)}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant={mode === 'replace' ? 'destructive' : 'primary'}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {importMutation.isPending
              ? mode === 'replace'
                ? 'Replacing...'
                : 'Importing...'
              : mode === 'replace'
                ? 'Replace rows'
                : 'Append rows'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
