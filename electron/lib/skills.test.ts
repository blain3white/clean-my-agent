import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatSkillPathForDisplay,
  inferSkillCategory,
  inferSkillIcon,
  parseSkillMetadata,
  resolveSkillRoots,
  scanSkills,
  summarizeSkills,
} from './skills'
import { expandHome } from './files'

let tmpDir: string

const roots = (root: string) => [
  { source: 'codex', root: path.join(root, 'codex'), primary: true },
  { source: 'claude', root: path.join(root, 'claude'), primary: true },
  { source: 'cursor', root: path.join(root, 'cursor'), primary: true },
]

async function writeSkill(
  root: string,
  source: 'codex' | 'claude' | 'cursor',
  slug: string,
  markdown: string,
) {
  const dir = path.join(root, source, slug)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'SKILL.md'), markdown)
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cma-skills-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('skill scanner', () => {
  it('parses quoted frontmatter and falls back to body copy', () => {
    expect(
      parseSkillMetadata(
        `---\nname: "PR Review"\ndescription: 'Review pull requests.'\n---\n\n# Body`,
        'pr-review',
      ),
    ).toEqual({
      name: 'PR Review',
      description: 'Review pull requests.',
    })

    expect(parseSkillMetadata('# Heading\n\nUse this skill for docs.', 'docs-writer')).toEqual({
      name: 'Docs Writer',
      description: 'Use this skill for docs.',
    })

    expect(parseSkillMetadata('---\nname: Broken Skill\n# only a heading', 'broken-skill')).toEqual(
      {
        name: 'Broken Skill',
        description: 'Local skill discovered from broken-skill/SKILL.md.',
      },
    )
  })

  it('infers stable categories from skill text', () => {
    expect(inferSkillCategory('UI Screenshot Analyzer', 'visual design review')).toBe('design')
    expect(inferSkillCategory('Release Notes', 'write markdown docs')).toBe('docs')
    expect(inferSkillCategory('Data Extractor', 'extract spreadsheet CSV data')).toBe('data')
    expect(inferSkillCategory('PR Review', 'review code and tests')).toBe('engineering')
    expect(inferSkillCategory('Focus Helper', 'organize daily work')).toBe('productivity')
  })

  it('infers skill icons from name and description keywords', () => {
    expect(inferSkillIcon('engineering', 'PR Review', 'review code')).toBe('review')
    expect(inferSkillIcon('engineering', 'Bug Doctor', 'debug failing tests')).toBe('bug')
    expect(inferSkillIcon('productivity', 'Find Skills', 'search local skills')).toBe('search')
    expect(inferSkillIcon('design', 'Visual UI', 'inspect screenshots')).toBe('image')
    expect(inferSkillIcon('data', 'CSV Extractor', 'extract analytics data')).toBe('data')
    expect(inferSkillIcon('docs', 'Spec Writer', 'write markdown docs')).toBe('spec')
    expect(inferSkillIcon('productivity', 'Daily Focus', 'organize work')).toBe('search')
  })

  it('resolves configured roots before default roots and removes duplicates per agent', () => {
    const roots = resolveSkillRoots({
      scanRoots: {
        codex: ['~/.codex/skills', path.join(tmpDir, 'codex')],
        claude: [path.join(tmpDir, 'claude'), path.join(tmpDir, 'claude')],
      },
    })

    expect(roots[0]).toEqual({ source: 'codex', root: '~/.codex/skills', primary: true })
    expect(roots[1]).toEqual({ source: 'codex', root: path.join(tmpDir, 'codex'), primary: true })
    expect(
      roots.filter((root) => root.source === 'claude' && root.root === path.join(tmpDir, 'claude')),
    ).toHaveLength(1)
    expect(resolveSkillRoots({ scanRoots: { codex: '/tmp' as never } }).length).toBeGreaterThan(0)
    expect(resolveSkillRoots()[0]).toEqual({
      source: 'codex',
      root: '~/.codex/skills',
      primary: true,
    })
    expect(resolveSkillRoots().some((root) => root.root.includes('/plugins/cache'))).toBe(false)
  })

  it('formats skill paths for display', () => {
    expect(formatSkillPathForDisplay(expandHome('~'))).toBe('~')
    expect(formatSkillPathForDisplay(expandHome('~/.codex/skills/example'))).toBe(
      '~/.codex/skills/example',
    )
    expect(formatSkillPathForDisplay('/tmp/clean-my-agent/skill')).toBe('/tmp/clean-my-agent/skill')
  })

  it('scans real SKILL.md files and links duplicate skill names across agents', async () => {
    await writeSkill(
      tmpDir,
      'codex',
      'pr-review',
      `---\nname: PR Review\ndescription: Review code before merge.\n---\n\n# PR Review`,
    )
    await writeSkill(
      tmpDir,
      'claude',
      'pr-review',
      `---\nname: PR Review\ndescription: Review code before merge.\n---\n\n# PR Review`,
    )
    await writeSkill(
      tmpDir,
      'cursor',
      'release-notes',
      `---\nname: Release Notes\ndescription: Write markdown changelogs.\n---`,
    )
    await mkdir(path.join(tmpDir, 'codex', 'ignored'), { recursive: true })
    await writeFile(path.join(tmpDir, 'codex', 'ignored', 'README.md'), 'not a skill')
    await mkdir(path.join(tmpDir, 'codex', 'pr-review', 'nested-history'), { recursive: true })
    await writeFile(
      path.join(tmpDir, 'codex', 'pr-review', 'nested-history', 'SKILL.md'),
      `---\nname: Nested History\ndescription: Should not be counted as an installed skill.\n---`,
    )

    const snapshot = await scanSkills(undefined, roots(tmpDir))

    expect(snapshot.skills).toHaveLength(2)
    expect(snapshot.summary.totalSkills).toBe(2)
    expect(snapshot.summary.linkedAgents).toBe(1)
    expect(snapshot.summary.linkedAgentTotal).toBe(2)
    expect(snapshot.summary.backups).toBe(0)
    expect(snapshot.summary.backupPercent).toBe(0)

    const review = snapshot.skills.find((skill) => skill.name === 'PR Review')
    expect(review?.status).toBe('synced')
    expect(review?.content).toContain('# PR Review')
    expect(review?.linkedAgents.sort().join(',')).toBe('claude,codex')

    const releaseNotes = snapshot.skills.find((skill) => skill.name === 'Release Notes')
    expect(releaseNotes).toMatchObject({
      ownerAgent: 'cursor',
      category: 'docs',
      status: 'local',
      version: 'local',
      usageCount: 0,
    })
    expect(releaseNotes?.location).toContain('release-notes')
  })

  it('skips unreadable or malformed skill files without aborting the scan', async () => {
    await writeSkill(
      tmpDir,
      'codex',
      'valid-skill',
      `---\nname: Valid Skill\ndescription: Search local data.\n---`,
    )
    await mkdir(path.join(tmpDir, 'codex', 'broken', 'SKILL.md'), { recursive: true })

    const snapshot = await scanSkills(undefined, roots(tmpDir))

    expect(snapshot.skills.map((skill) => skill.name)).toEqual(['Valid Skill'])
    expect(snapshot.summary.totalSkills).toBe(1)
  })

  it('summarizes recently changed and backed-up skills', () => {
    const summary = summarizeSkills(
      [
        {
          id: 'a',
          name: 'A',
          description: 'A',
          ownerAgent: 'codex',
          category: 'engineering',
          content: '# A',
          updatedAt: '2026-06-07T00:00:00.000Z',
          sizeKb: 1,
          status: 'backed-up',
          linkedAgents: ['codex'],
          version: 'local',
          createdAt: '2026-06-01T00:00:00.000Z',
          usageCount: 0,
          location: '~/.codex/skills/a',
          accent: 'violet',
          icon: 'code',
        },
        {
          id: 'b',
          name: 'B',
          description: 'B',
          ownerAgent: 'claude',
          category: 'docs',
          content: '# B',
          updatedAt: '2026-05-01T00:00:00.000Z',
          sizeKb: 1,
          status: 'synced',
          linkedAgents: ['claude', 'codex'],
          version: 'local',
          createdAt: '2026-05-01T00:00:00.000Z',
          usageCount: 0,
          location: '~/.claude/skills/b',
          accent: 'green',
          icon: 'notes',
        },
        {
          id: 'c',
          name: 'C',
          description: 'C',
          ownerAgent: 'cursor',
          category: 'data',
          content: '# C',
          updatedAt: 'not-a-date',
          sizeKb: 1,
          status: 'local',
          linkedAgents: ['cursor'],
          version: 'local',
          createdAt: '2026-05-01T00:00:00.000Z',
          usageCount: 0,
          location: '~/.cursor/skills/c',
          accent: 'cyan',
          icon: 'data',
        },
      ],
      new Date('2026-06-08T00:00:00.000Z').getTime(),
    )

    expect(summary).toEqual({
      totalSkills: 3,
      weeklyDelta: 1,
      linkedAgents: 1,
      linkedAgentTotal: 2,
      backups: 1,
      backupPercent: 33,
      recentlyChanged: 1,
    })
  })

  it('summarizes an empty skill list', () => {
    expect(summarizeSkills([])).toEqual({
      totalSkills: 0,
      weeklyDelta: 0,
      linkedAgents: 0,
      linkedAgentTotal: 0,
      backups: 0,
      backupPercent: 0,
      recentlyChanged: 0,
    })
  })
})
