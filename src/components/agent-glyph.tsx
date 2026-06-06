import { type CSSProperties } from 'react'
import CodexIcon from '@lobehub/icons/es/Codex'
import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode'
import CursorIcon from '@lobehub/icons/es/Cursor'
import GeminiIcon from '@lobehub/icons/es/Gemini'
import OpenCodeIcon from '@lobehub/icons/es/OpenCode'
import { Bot } from 'lucide-react'
import { sourceColors, sourceIconColors } from '@/lib/agent-colors'
import type { AgentSource } from '@/shared/types'

type AgentLogoStyle = CSSProperties & { '--agent-color': string }

export function AgentGlyph({ source }: { source: AgentSource }) {
  const iconProps = { size: 16 }
  const icon = {
    codex: <CodexIcon {...iconProps} />,
    claude: <ClaudeCodeIcon {...iconProps} />,
    cursor: <CursorIcon {...iconProps} />,
    gemini: <GeminiIcon {...iconProps} />,
    opencode: <OpenCodeIcon {...iconProps} />,
  }[source]

  return (
    <span
      className="agent-logo grid size-8 place-items-center"
      data-source={source}
      style={
        { '--agent-color': sourceColors[source], color: sourceIconColors[source] } as AgentLogoStyle
      }
    >
      {icon ?? <Bot className="size-4" />}
    </span>
  )
}
