# Security Policy

Clean My Agent works with local AI-agent session data. Please report security or privacy issues privately before opening a public issue.

## Supported Versions

The open-source project is pre-1.0. Security fixes target the latest commit on `main` unless maintainers publish a separate release policy.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled, contact the repository owner privately through GitHub.

Please include:

- A clear description of the issue.
- Steps to reproduce.
- The affected commit or version.
- Whether credential-like files, private paths, session content, backups, exports, cleanup, or Trash behavior are involved.

Do not include real API keys, OAuth tokens, secrets, private session transcripts, or unredacted local paths in reports.

## Project Safety Expectations

- Credential-like files must not be scanned, copied, exported, or logged.
- Cleanup should move files to app-managed Trash rather than deleting permanently.
- Risky cleanup actions should be backed up first.
- Reports involving user data exposure are treated as high priority.
