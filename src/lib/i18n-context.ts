import { createContext, useContext } from 'react'
import {
  appLanguageToLocale,
  defaultLanguage,
  formatRelativeForLanguage,
  translate,
  type I18nContextValue,
} from './i18n'

export const i18nContext = createContext<I18nContextValue>({
  language: defaultLanguage,
  locale: appLanguageToLocale(defaultLanguage),
  t: (key, values) => translate(defaultLanguage, key, values),
  formatRelative: (value) => formatRelativeForLanguage(value, defaultLanguage),
})

export function useI18n(): I18nContextValue {
  return useContext(i18nContext)
}
