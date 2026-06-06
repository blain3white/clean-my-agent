import { describe, expect, it } from 'vitest'
import type { TokenUsage } from './types'
import {
  calculateUsageModelCost,
  hasUsageModelPricing,
  pricingForModel,
  usageCostFromTokenUsage,
} from './usage-pricing'

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
    expect(pricingForModel()).toBeUndefined()
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

  it('prefers longer model keys before broader family keys', () => {
    expect(pricingForModel('claude-opus-4-5-20251101')?.input).toBe(5)
    expect(pricingForModel('claude-opus-4')?.input).toBe(15)
    expect(
      calculateUsageModelCost({
        model: 'claude-opus-4',
        input: 1_000_000,
        output: 1_000_000,
        cacheCreation: 1_000_000,
        cacheRead: 1_000_000,
      }),
    ).toBeCloseTo(110.25)
  })

  it('matches uppercase and Gemini model names', () => {
    expect(hasUsageModelPricing('CLAUDE-SONNET-4-6')).toBe(true)
    expect(pricingForModel('gemini-2.5-pro')?.output).toBe(10)
    expect(pricingForModel('gemini-2.5-flash')?.input).toBe(0.15)
  })

  it('returns zero cost for known models with zero token usage', () => {
    expect(
      calculateUsageModelCost({
        model: 'claude-haiku-4-5',
        input: 0,
        output: 0,
      }),
    ).toBe(0)
  })

  it('uses explicit costs before model estimates', () => {
    const tokens: TokenUsage = {
      input: 1_000_000,
      output: 1_000_000,
      cached: 0,
      total: 2_000_000,
      costUsd: 0,
      model: 'claude-sonnet-4-6',
      estimated: false,
    }

    expect(usageCostFromTokenUsage({ ...tokens, costUsd: 0.42 })).toBe(0.42)
    expect(usageCostFromTokenUsage(tokens)).toBe(0)
  })

  it('estimates usage cost from token usage when explicit cost is absent', () => {
    expect(
      usageCostFromTokenUsage({
        input: 1_000_000,
        output: 0,
        cached: 0,
        total: 1_000_000,
        model: 'claude-sonnet-4-6',
        estimated: false,
      }),
    ).toBeCloseTo(3)
  })
})
