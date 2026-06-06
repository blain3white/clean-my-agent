import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultLanguage } from '@/shared/types'
import {
  appLanguageToLocale,
  formatRelativeForLanguage,
  languageOptions,
  normalizeLanguage,
  translate,
} from './i18n'

describe('i18n helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes browser language values to supported app languages', () => {
    expect(normalizeLanguage()).toBe(defaultLanguage)
    expect(normalizeLanguage('')).toBe(defaultLanguage)
    expect(normalizeLanguage(null)).toBe(defaultLanguage)
    expect(normalizeLanguage('en')).toBe('en')
    expect(normalizeLanguage('en-US')).toBe('en')
    expect(normalizeLanguage('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeLanguage('zh-TW')).toBe('zh-CN')
    expect(normalizeLanguage('ja-JP')).toBe('ja')
    expect(normalizeLanguage('fr-FR')).toBe('fr')
    expect(normalizeLanguage('fr-CA')).toBe('fr')
    expect(normalizeLanguage('de-DE')).toBe(defaultLanguage)
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN')
  })

  it('exposes display labels for all supported app languages', () => {
    expect(languageOptions.map((option) => option.value)).toEqual(['en', 'zh-CN', 'ja', 'fr'])
    expect(languageOptions.find((option) => option.value === 'fr')?.nativeLabel).toBe('Français')
  })

  it('maps app languages to Intl locales', () => {
    expect(appLanguageToLocale('en')).toBe('en-US')
    expect(appLanguageToLocale('zh-CN')).toBe('zh-CN')
    expect(appLanguageToLocale('ja')).toBe('ja-JP')
    expect(appLanguageToLocale('fr')).toBe('fr-FR')
  })

  it('translates known keys with interpolation', () => {
    expect(translate('en', 'nav.overview')).toBe('Overview')
    expect(translate('zh-CN', 'nav.settings')).toBe('设置')
    expect(translate('ja', 'cleanup.categoryLargeDescription')).toContain('異常に')
    expect(translate('zh-CN', 'toast.languageUpdated', { language: '中文' })).toBe(
      '语言已更新为 中文',
    )
    expect(translate('fr', 'toast.languageUpdated', { language: 'Français' })).toBe(
      'Langue mise à jour : Français',
    )
  })

  it('keeps unknown interpolation placeholders visible', () => {
    expect(translate('en', 'toast.exported')).toBe('Exported to {path}')
    expect(translate('en', 'nav.overview' as never, { unused: 'value' })).toBe('Overview')
  })

  it('formats relative dates with localized fallbacks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))

    expect(formatRelativeForLanguage(undefined, 'en')).toBe('Never')
    expect(formatRelativeForLanguage('not-a-date', 'zh-CN')).toBe('未知')
    expect(formatRelativeForLanguage('2026-06-06T12:00:00.000Z', 'ja')).toBe('たった今')
    expect(formatRelativeForLanguage('2026-06-06T11:00:00.000Z', 'en')).toBe('1 hour ago')
    expect(formatRelativeForLanguage('2026-06-06T11:59:00.000Z', 'en')).toBe('1 minute ago')
    expect(formatRelativeForLanguage('2026-06-05T12:00:00.000Z', 'fr')).toBe('hier')
    expect(formatRelativeForLanguage('2026-05-01T12:00:00.000Z', 'en')).toBe('5/1/2026')
  })
})
