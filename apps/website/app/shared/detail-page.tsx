import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'

type DetailContent = {
  eyebrow: string
  title: string
  summary: string
  icon: LucideIcon
  steps: string[]
  notes: string[]
}

export function DetailPage({ page }: { page: DetailContent }) {
  const Icon = page.icon

  return (
    <article className="doc-page detail-page">
      <header className="doc-hero compact">
        <Icon aria-hidden="true" size={34} />
        <p className="eyebrow">{page.eyebrow}</p>
        <h1>{page.title}</h1>
        <p>{page.summary}</p>
      </header>

      <section className="doc-section">
        <h2>Steps</h2>
        <ol className="numbered-guide">
          {page.steps.map((step) => (
            <li key={step}>
              <p>{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="doc-section">
        <h2>Important notes</h2>
        <ul className="check-list">
          {page.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <nav className="doc-next" aria-label="Related guides">
        <Link href="/manual">Full manual</Link>
        <Link href="/scan">Scan</Link>
        <Link href="/clean">Clean</Link>
        <Link href="/restore">Restore</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/export">Export</Link>
      </nav>
    </article>
  )
}
