import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultLanguage } from '@/shared/types'
import {
  appLanguageToLocale,
  formatRelativeForLanguage,
  normalizeLanguage,
  translate,
} from './i18n'

describe('i18n helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes browser language values to supported app languages', () => {
    expect(normalizeLanguage()).toBe(defaultLanguage)
    expect(normalizeLanguage('en-US')).toBe('en')
    expect(normalizeLanguage('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeLanguage('ja-JP')).toBe('ja')
    expect(normalizeLanguage('fr-FR')).toBe('fr')
    expect(normalizeLanguage('de-DE')).toBe(defaultLanguage)
  })

  it('maps app languages to Intl locales', () => {
    expect(appLanguageToLocale('en')).toBe('en-US')
    expect(appLanguageToLocale('zh-CN')).toBe('zh-CN')
    expect(appLanguageToLocale('ja')).toBe('ja-JP')
    expect(appLanguageToLocale('fr')).toBe('fr-FR')
  })

  it('translates known keys with interpolation', () => {
    expect(translate('zh-CN', 'nav.settings')).toBe('设置')
    expect(translate('ja', 'cleanup.categoryLargeDescription')).toContain('異常に')
    expect(translate('fr', 'toast.languageUpdated', { language: 'Français' })).toBe(
      'Langue mise à jour : Français',
    )
  })

  it('keeps unknown interpolation placeholders visible', () => {
    expect(translate('en', 'toast.exported')).toBe('Exported to {path}')
  })

  it('formats relative dates with localized fallbacks', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-06T12:00:00.000Z'))

    expect(formatRelativeForLanguage(undefined, 'en')).toBe('Never')
    expect(formatRelativeForLanguage('not-a-date', 'zh-CN')).toBe('未知')
    expect(formatRelativeForLanguage('2026-06-06T12:00:00.000Z', 'ja')).toBe('たった今')
  })
})
