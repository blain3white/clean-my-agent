import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useI18n } from './i18n-context'

function Probe() {
  const i18n = useI18n()
  return createElement(
    'span',
    null,
    `${i18n.language}|${i18n.locale}|${i18n.t('nav.settings')}|${i18n.formatRelative(undefined)}`,
  )
}

describe('i18n context', () => {
  it('provides English defaults outside an explicit provider', () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>en|en-US|Settings|Never</span>')
  })
})
