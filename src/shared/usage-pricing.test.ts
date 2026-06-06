import { describe, expect, it } from 'vitest'
import { calculateUsageModelCost, hasUsageModelPricing } from './usage-pricing'

describe('usage pricing', () => {
  it('calculates model-specific costs by token class', () => {
    expect(
      calculateUsageModelCost({
        model: 'claude-sonnet-4-5-20250929',
        input: 1_000_000,
        output: 1_000_000,
        cacheCreation: 1_000_000,
        cacheRead: 1_000_000,
      }),
    ).toBeCloseTo(22.05)
  })

  it('uses cached input rates for Codex/OpenAI models', () => {
    expect(
      calculateUsageModelCost({
        model: 'gpt-5-codex',
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
      }),
    ).toBeCloseTo(11.375)
  })

  it('does not invent costs for unknown models', () => {
    expect(hasUsageModelPricing('cursor-unknown-model')).toBe(false)
    expect(
      calculateUsageModelCost({
        model: 'cursor-unknown-model',
        input: 1_000_000,
        output: 1_000_000,
      }),
    ).toBeUndefined()
  })

  it('matches local shorthand model names to explicit pricing', () => {
    expect(hasUsageModelPricing('gpt5.5')).toBe(true)
    expect(hasUsageModelPricing('gpt5.4')).toBe(true)
    expect(hasUsageModelPricing('5.4')).toBe(true)
    expect(hasUsageModelPricing('sonnet4.6')).toBe(true)
    expect(
      calculateUsageModelCost({
        model: 'gpt5.5',
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
      }),
    ).toBeCloseTo(35.5)
    expect(
      calculateUsageModelCost({
        model: 'sonnet4.6',
        input: 1_000_000,
        output: 1_000_000,
        cacheCreation: 1_000_000,
        cacheRead: 1_000_000,
      }),
    ).toBeCloseTo(22.05)
  })
})
