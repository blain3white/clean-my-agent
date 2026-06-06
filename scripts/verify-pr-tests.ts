import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

type PullRequestPayload = {
  pull_request?: {
    base?: {
      sha?: string
    }
    head?: {
      sha?: string
    }
  }
}

const coreProductionPatterns = [
  /^electron\/lib\/.+\.ts$/,
  /^src\/lib\/.+\.ts$/,
  /^src\/shared\/.+\.ts$/,
]

const testPatterns = [
  /^electron\/.+\.test\.ts$/,
  /^src\/.+\.test\.tsx?$/,
  /^scripts\/verify-functions\.ts$/,
]

const ignoredProductionPatterns = [/\.test\.tsx?$/, /^src\/lib\/mock-data\.ts$/]

function runGit(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function readPullRequestPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) {
    return {}
  }

  try {
    return JSON.parse(readFileSync(eventPath, 'utf8')) as PullRequestPayload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read GitHub event payload at ${eventPath}: ${message}`, {
      cause: error,
    })
  }
}

function resolveDiffRange() {
  const payload = readPullRequestPayload()
  const baseSha = payload.pull_request?.base?.sha
  const headSha = payload.pull_request?.head?.sha

  if (baseSha && headSha) {
    return `${baseSha}...${headSha}`
  }

  const baseRef = process.env.GITHUB_BASE_REF
  if (baseRef) {
    return `origin/${baseRef}...HEAD`
  }

  return 'origin/develop...HEAD'
}

function listChangedFiles(diffRange: string) {
  const output = runGit(['diff', '--name-only', '--diff-filter=ACMR', diffRange])
  return output ? output.split('\n').filter(Boolean) : []
}

function matchesAny(filePath: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(filePath))
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    console.log('PR test gate skipped: not running for a pull_request event.')
    return
  }

  const diffRange = resolveDiffRange()
  const changedFiles = listChangedFiles(diffRange)
  const coreProductionChanges = changedFiles.filter(
    (filePath) =>
      matchesAny(filePath, coreProductionPatterns) &&
      !matchesAny(filePath, ignoredProductionPatterns),
  )
  const testChanges = changedFiles.filter((filePath) => matchesAny(filePath, testPatterns))

  if (coreProductionChanges.length === 0) {
    console.log('PR test gate passed: no core production files changed.')
    return
  }

  if (testChanges.length > 0) {
    console.log('PR test gate passed: core changes include test coverage changes.')
    console.log(
      `Core production changes:\n${coreProductionChanges.map((file) => `- ${file}`).join('\n')}`,
    )
    console.log(`Test changes:\n${testChanges.map((file) => `- ${file}`).join('\n')}`)
    return
  }

  console.error('PR test gate failed: core production files changed without test changes.')
  console.error('\nCore production changes:')
  console.error(coreProductionChanges.map((file) => `- ${file}`).join('\n'))
  console.error(
    '\nAdd or update focused unit tests (`*.test.ts`/`*.test.tsx`) or the functional smoke test.',
  )
  process.exitCode = 1
}

main()
