import { useState } from 'react'
import { FileJson2 } from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { agentLabel, formatTokens } from '@/lib/format'
import type { SessionRecord } from '@/shared/types'

export function RelayView({
  sessions,
  onRelay,
}: {
  sessions: SessionRecord[]
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [selected, setSelected] = useState(sessions[0]?.id ?? '')
  const session = sessions.find((item) => item.id === selected)

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Universal Relay JSON</CardTitle>
          <p className="mt-1 text-xs text-white/42">
            V0 extracts chats into a common schema. Agent-specific converters can target Codex,
            Claude Code, Cursor, Gemini, or OpenCode later.
          </p>
        </CardHeader>
        <CardContent>
          <pre className="overflow-hidden rounded-lg border border-white/8 bg-black/25 p-4 text-xs leading-5 text-white/58">
            {`{
  "schema": "clean-my-agent.universal-session.v1",
  "source": "${session?.source ?? 'codex'}",
  "session": {
    "title": "${session?.title ?? 'Select a session'}",
    "projectPath": "${session?.projectPath ?? ''}",
    "branch": "${session?.branch ?? ''}"
  },
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "files": [],
  "commands": [],
  "git": { "diff": null },
  "attachments": []
}`}
          </pre>
        </CardContent>
      </Card>

      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Export Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
          >
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {agentLabel[item.source]} · {item.title}
              </option>
            ))}
          </select>
          {session && (
            <div className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <AgentGlyph source={session.source} />
                <span className="text-sm font-medium text-white/82">{session.title}</span>
              </div>
              <div className="mt-3 space-y-1 text-xs text-white/42">
                <div>{session.projectName}</div>
                <div>
                  {session.messageCount} messages · {formatTokens(session.tokens.total)} tokens
                </div>
              </div>
            </div>
          )}
          <Button
            disabled={!session}
            onClick={() => session && void onRelay(session.id)}
            className="w-full bg-blue-500 text-white hover:bg-blue-400"
          >
            <FileJson2 className="size-4" />
            Export Universal JSON
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
