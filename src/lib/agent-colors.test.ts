import { describe, expect, it } from 'vitest'
import { agentSources } from '@/shared/types'
import { sourceColors, sourceIconColors } from './agent-colors'

describe('agent color maps', () => {
  it('defines a chart color for every agent source', () => {
    expect(Object.keys(sourceColors).sort()).toEqual([...agentSources].sort())
    for (const source of agentSources) {
      expect(sourceColors[source]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('uses high-contrast icon colors for neutral agents', () => {
    expect(sourceIconColors.cursor).toBe('#f8fafc')
    expect(sourceIconColors.opencode).toBe('#f8fafc')
    expect(sourceIconColors.codex).toBe(sourceColors.codex)
  })
})
