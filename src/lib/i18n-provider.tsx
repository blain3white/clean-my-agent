import { useEffect, useMemo, type ReactNode } from 'react'
import type { AppLanguage } from '@/shared/types'
import {
  appLanguageToLocale,
  formatRelativeForLanguage,
  translate,
  type I18nContextValue,
} from './i18n'
import { i18nContext } from './i18n-context'

export function I18nProvider({
  children,
  language,
}: {
  children: ReactNode
  language: AppLanguage
}) {
  const locale = appLanguageToLocale(language)

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      locale,
      t: (key, values) => translate(language, key, values),
      formatRelative: (date?: string) => formatRelativeForLanguage(date, language),
    }),
    [language, locale],
  )

  return <i18nContext.Provider value={value}>{children}</i18nContext.Provider>
}
