import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import './globals.css'
import { navItems, product } from './content'

export const metadata: Metadata = {
  title: {
    default: 'Clean My Agent - User Manual',
    template: '%s - Clean My Agent',
  },
  description:
    'The user-facing guide for Clean My Agent: scan, clean, back up, export, restore, and keep AI coding-agent data private.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Clean My Agent home">
            <Image src="/images/app-logo.png" alt="" width={36} height={36} priority />
            <span>{product.name}</span>
          </Link>
          <nav className="nav-links" aria-label="Primary navigation">
            {navItems.map((item) => (
              <Link href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <a className="header-download" href={product.downloadUrl}>
            Download
          </a>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div>
            <strong>{product.name}</strong>
            <p>Local-first cleanup, backup, export, and restore for AI coding-agent sessions.</p>
          </div>
          <div className="footer-links">
            <Link href="/manual">Manual</Link>
            <Link href="/privacy">Privacy</Link>
            <a href={product.repoUrl}>GitHub</a>
          </div>
        </footer>
      </body>
    </html>
  )
}
