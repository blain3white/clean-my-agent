import { describe, expect, it } from 'vitest'
import {
  trashPrimaryPath,
  usageTimezoneOptions,
  usageTimezoneSelectOptions,
} from './settings-model'
import type { TrashRecord } from '@/shared/types'

function trashRecord(patch: Partial<TrashRecord> = {}): TrashRecord {
  return {
    id: 'trash-1',
    candidateId: 'candidate-1',
    title: 'Deleted session',
    source: 'codex',
    originalPaths: ['/workspace/session.jsonl'],
    trashPath: '/app/Trash/session.jsonl',
    sizeBytes: 42,
    deletedAt: '2026-02-01T00:00:00.000Z',
    risk: 'low',
    recoverable: true,
    ...patch,
  }
}

describe('usageTimezoneSelectOptions', () => {
  it('keeps the current setting first even when it is outside the default list', () => {
    expect(usageTimezoneSelectOptions('Pacific/Auckland').slice(0, 2)).toEqual([
      { value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
      { value: 'UTC', label: 'UTC' },
    ])
  })

  it('deduplicates the current setting when it is already a default option', () => {
    const options = usageTimezoneSelectOptions('UTC')
    expect(options.filter((option) => option.value === 'UTC')).toHaveLength(1)
    expect(options).toHaveLength(usageTimezoneOptions.length)
  })
})

describe('trashPrimaryPath', () => {
  it('returns the first original path when available', () => {
    expect(trashPrimaryPath(trashRecord({ originalPaths: ['/first', '/second'] }))).toBe('/first')
  })

  it('falls back to the trash path for records without an original path', () => {
    expect(trashPrimaryPath(trashRecord({ originalPaths: [] }))).toBe('/app/Trash/session.jsonl')
  })
})
