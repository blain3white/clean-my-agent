import type { TokenUsage } from './types'

export type UsageModelPricing = {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

const modelPricing: Record<string, UsageModelPricing> = {
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-3-5-haiku': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-haiku': { input: 0.25, output: 1.25, cacheWrite: 0.3, cacheRead: 0.03 },
  'gpt-5.2-codex': { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  'gpt-5.1-codex-mini': { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 },
  'gpt-5.1-codex-max': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-5.1-codex': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-5.3-codex': { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  'gpt-5-codex': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-5.2': { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
  'gpt-5.5': { input: 5, output: 30, cacheWrite: 0, cacheRead: 0.5 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5, cacheWrite: 0, cacheRead: 0.075 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25, cacheWrite: 0, cacheRead: 0.02 },
  'gpt-5.4': { input: 2.5, output: 15, cacheWrite: 0, cacheRead: 0.25 },
  'gpt-5.1': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 },
  'gpt-5-nano': { input: 0.05, output: 0.4, cacheWrite: 0, cacheRead: 0.005 },
  'gpt-5': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheWrite: 0, cacheRead: 0.04 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 0.01 },
  'gpt-4.1': { input: 2, output: 8, cacheWrite: 0, cacheRead: 0.2 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheWrite: 0, cacheRead: 0.015 },
  'gpt-4o': { input: 2.5, output: 10, cacheWrite: 0, cacheRead: 0.25 },
  'o4-mini': { input: 1.1, output: 4.4, cacheWrite: 0, cacheRead: 0.11 },
  'codex-mini-latest': { input: 1.5, output: 6, cacheWrite: 0, cacheRead: 0.15 },
  'codex-mini': { input: 1.5, output: 6, cacheWrite: 0, cacheRead: 0.15 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6, cacheWrite: 0, cacheRead: 0 },
}

const sortedModelPricingEntries = Object.entries(modelPricing).sort(
  ([left], [right]) => right.length - left.length,
)

export function canonicalModelKey(modelName?: string): string {
  if (!modelName) return ''
  return normalizedModelName(modelName)
}

function normalizedModelName(modelName: string): string {
  const normalized = modelName
    .toLowerCase()
    .trim()
    .replace(/\bgpt\s*([0-9])/g, 'gpt-$1')
    .replace(/\bgpt([0-9])/g, 'gpt-$1')
    .replace(/\bsonnet\s*([0-9])/g, 'claude-sonnet-$1')
    .replace(/\bsonnet([0-9])/g, 'claude-sonnet-$1')
    .replace(/\bopus\s*([0-9])/g, 'claude-opus-$1')
    .replace(/\bopus([0-9])/g, 'claude-opus-$1')
    .replace(/\bhaiku\s*([0-9])/g, 'claude-haiku-$1')
    .replace(/\bhaiku([0-9])/g, 'claude-haiku-$1')
    .replace(/\bclaude-(sonnet|opus|haiku)-([0-9]+)\.([0-9]+)/g, 'claude-$1-$2-$3')

  return /^5\.[45]$/.test(normalized) ? `gpt-${normalized}` : normalized
}

export function pricingForModel(modelName?: string): UsageModelPricing | undefined {
  if (!modelName) return undefined
  const normalized = normalizedModelName(modelName)
  return sortedModelPricingEntries.find(([key]) => normalized.includes(key))?.[1]
}

export function hasUsageModelPricing(modelName?: string): boolean {
  return pricingForModel(modelName) !== undefined
}

export function calculateUsageModelCost({
  model,
  input,
  output,
  cacheCreation,
  cacheRead,
}: {
  model?: string
  input: number
  output: number
  cacheCreation?: number
  cacheRead?: number
}): number | undefined {
  const pricing = pricingForModel(model)
  if (!pricing) return undefined

  return (
    (input / 1_000_000) * pricing.input +
    (output / 1_000_000) * pricing.output +
    ((cacheCreation ?? 0) / 1_000_000) * pricing.cacheWrite +
    ((cacheRead ?? 0) / 1_000_000) * pricing.cacheRead
  )
}

export function usageCostFromTokenUsage(tokens: TokenUsage): number | undefined {
  if (typeof tokens.costUsd === 'number') return tokens.costUsd
  return calculateUsageModelCost({
    model: tokens.model,
    input: tokens.input,
    output: tokens.output,
    cacheCreation: tokens.cacheCreation,
    cacheRead: tokens.cacheRead,
  })
}
