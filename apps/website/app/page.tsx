import {
  ArrowRight,
  CheckCircle2,
  Download,
  GitBranch,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { faqItems, pillars, product, quickWorkflow, supportedAgents, trustCards } from './content'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Local-first desktop app</p>
          <h1>{product.name}</h1>
          <p className="hero-subtitle">
            Scan, understand, back up, export, and safely clean AI coding-agent sessions without
            giving up local control.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={product.downloadUrl}>
              <Download aria-hidden="true" size={18} />
              Download for macOS
            </a>
            <Link className="button button-secondary" href="/manual">
              Read the manual
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          </div>
          <div className="hero-meta" aria-label="Supported agents">
            {supportedAgents.map((agent) => (
              <span key={agent}>{agent}</span>
            ))}
          </div>
        </div>
        <div className="hero-visual">
          <Image
            src="/images/clean-my-agent-hero.png"
            alt="Clean My Agent dashboard showing storage, sessions, and cleanup status"
            width={1672}
            height={941}
            priority
          />
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <p className="eyebrow">What it is for</p>
          <h2>Make agent data understandable before it becomes clutter.</h2>
          <p>
            AI coding agents leave behind conversations, logs, caches, backups, and project traces.
            Clean My Agent gives you one place to decide what to keep, export, restore, or clean.
          </p>
        </div>
        <div className="feature-grid">
          {pillars.map((pillar) => {
            const Icon = pillar.icon
            return (
              <article className="feature-card" key={pillar.title}>
                <Icon aria-hidden="true" size={26} />
                <h3>{pillar.title}</h3>
                <p>{pillar.text}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="workflow-band">
        <div className="section-heading align-left">
          <p className="eyebrow">User flow</p>
          <h2>From scan to cleanup, every step stays reviewable.</h2>
        </div>
        <ol className="workflow-list">
          {quickWorkflow.map((step, index) => (
            <li key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="split-section">
        <div>
          <p className="eyebrow">Privacy promise</p>
          <h2>Your agent history stays on your machine.</h2>
          <p>
            Clean My Agent is designed around local files and explicit user decisions. It reads
            first, skips secrets, explains cleanup opportunities, and moves selected files to app
            Trash.
          </p>
          <Link className="text-link" href="/privacy">
            Read privacy details <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
        <div className="trust-grid">
          {trustCards.map((card) => {
            const Icon = card.icon
            return (
              <article key={card.title}>
                <Icon aria-hidden="true" size={22} />
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="manual-preview">
        <div className="manual-preview-copy">
          <ScanSearch aria-hidden="true" size={32} />
          <h2>A real user manual, not a developer README.</h2>
          <p>
            Learn what the app does, how to scan, when to clean, how recovery works, which exports
            to choose, and how privacy is protected.
          </p>
        </div>
        <div className="manual-link-list">
          {[
            ['Start here', '/manual'],
            ['Scan sessions', '/scan'],
            ['Clean safely', '/clean'],
            ['Restore data', '/restore'],
            ['Export history', '/export'],
            ['Privacy model', '/privacy'],
          ].map(([label, href]) => (
            <Link href={href} key={href}>
              <CheckCircle2 aria-hidden="true" size={18} />
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section className="section faq-section">
        <div className="section-heading">
          <p className="eyebrow">Questions</p>
          <h2>Common cleanup concerns</h2>
        </div>
        <div className="faq-grid">
          {faqItems.map((item) => (
            <article className="faq-item" key={item.q}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </article>
          ))}
        </div>
        <div className="repo-callout">
          <ShieldCheck aria-hidden="true" size={24} />
          <div>
            <h3>Open source and inspectable</h3>
            <p>Review the project, report issues, and follow releases on GitHub.</p>
          </div>
          <a className="button button-secondary" href={product.repoUrl}>
            <GitBranch aria-hidden="true" size={18} />
            GitHub
          </a>
        </div>
      </section>
    </>
  )
}
