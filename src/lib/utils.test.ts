import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges class names and skips falsey inputs', () => {
    const disabled = false

    expect(cn('base', disabled && 'hidden', undefined, null, 'active')).toBe('base active')
  })

  it('lets later Tailwind utilities win for conflicting groups', () => {
    expect(cn('px-2 py-1 text-sm', 'px-4', 'text-lg')).toBe('py-1 px-4 text-lg')
  })
})
