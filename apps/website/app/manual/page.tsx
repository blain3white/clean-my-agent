import Link from 'next/link'
import { manualCallouts, manualSections, quickWorkflow, supportLinks } from '../content'

export const metadata = {
  title: 'User Manual',
  description:
    'Learn how to use Clean My Agent to scan, clean, restore, export, and protect local AI coding-agent sessions.',
}

export default function ManualPage() {
  return (
    <article className="doc-page">
      <header className="doc-hero">
        <p className="eyebrow">User Manual</p>
        <h1>Use Clean My Agent with confidence.</h1>
        <p>
          This guide explains what the app does, how each workflow behaves, and how to make cleanup
          decisions without losing useful agent history.
        </p>
      </header>

      <section className="callout-row">
        {manualCallouts.map((callout) => {
          const Icon = callout.icon
          return (
            <article key={callout.title}>
              <Icon aria-hidden="true" size={24} />
              <h2>{callout.title}</h2>
              <p>{callout.text}</p>
            </article>
          )
        })}
      </section>

      <section className="doc-section">
        <h2>Recommended first run</h2>
        <ol className="numbered-guide">
          {quickWorkflow.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {manualSections.map((section) => {
        const Icon = section.icon
        return (
          <section className="doc-section" id={section.id} key={section.id}>
            <div className="doc-section-title">
              <Icon aria-hidden="true" size={24} />
              <div>
                <p className="eyebrow">{section.eyebrow}</p>
                <h2>{section.title}</h2>
              </div>
            </div>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <ul className="check-list">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </section>
        )
      })}

      <section className="doc-section">
        <h2>Where to go next</h2>
        <div className="support-links">
          {supportLinks.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
          <Link href="/privacy">Privacy guide</Link>
        </div>
      </section>
    </article>
  )
}
