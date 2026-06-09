import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileArchive,
  GitBranch,
  ScanSearch,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { faqItems, pillars, product, quickWorkflow, trustCards } from './content'
import Aurora from './shared/aurora/Aurora'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-aurora" aria-hidden="true">
          <Aurora
            amplitude={1.25}
            blend={0.42}
            colorStops={['#0f766e', '#9ce0cf', '#4f46e5']}
            speed={0.7}
          />
        </div>
        <div className="hero-copy">
          <div className="hero-kicker">
            <span>Local-first desktop app</span>
            <span>Codex, Claude Code, Cursor, Gemini, OpenCode</span>
          </div>
          <h1>{product.name}</h1>
          <p className="hero-subtitle">
            A calm control surface for scanning, backing up, exporting, and safely cleaning local AI
            coding-agent sessions.
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
          <div className="hero-proof" aria-label="Clean My Agent safety model">
            <span>
              <ScanSearch aria-hidden="true" size={16} />
              Read-only scan
            </span>
            <span>
              <FileArchive aria-hidden="true" size={16} />
              Backup before risk
            </span>
            <span>
              <Trash2 aria-hidden="true" size={16} />
              Restore from Trash
            </span>
          </div>
        </div>
        <div className="hero-stage" aria-label="Clean My Agent product preview">
          <div className="hero-window">
            <div className="window-bar">
              <span />
              <span />
              <span />
              <strong>Clean My Agent</strong>
            </div>
            <div className="window-grid">
              <aside className="window-sidebar">
                <span className="sidebar-label">Agent sources</span>
                {[
                  ['Codex', '12.4 GB'],
                  ['Claude Code', '8.7 GB'],
                  ['Cursor', '6.1 GB'],
                  ['Gemini', '3.2 GB'],
                  ['OpenCode', '2.8 GB'],
                ].map(([agent, size]) => (
                  <div className="source-row" key={agent}>
                    <span>{agent}</span>
                    <strong>{size}</strong>
                  </div>
                ))}
              </aside>
              <div className="window-main">
                <div className="metric-row">
                  <div>
                    <span>Total scanned</span>
                    <strong>33.2 GB</strong>
                  </div>
                  <div>
                    <span>Reclaimable</span>
                    <strong>4.7 GB</strong>
                  </div>
                  <div>
                    <span>Sessions</span>
                    <strong>1,835</strong>
                  </div>
                </div>
                <div className="cleanup-board">
                  <div>
                    <span>Safe cleanup queue</span>
                    <strong>Review before moving anything</strong>
                  </div>
                  {['Old temp files', 'Expired sessions', 'Large logs'].map((item, index) => (
                    <div className="cleanup-row" key={item}>
                      <span>{item}</span>
                      <i>{['2.1 GB', '1.6 GB', '620 MB'][index]}</i>
                    </div>
                  ))}
                </div>
                <div className="safety-flow">
                  <span>Scan</span>
                  <span>Backup</span>
                  <span>Trash</span>
                  <span>Restore</span>
                </div>
              </div>
            </div>
          </div>
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
