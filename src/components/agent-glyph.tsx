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

// Pi's official brand mark: a P-shaped glyph plus an i dot (the "Pi" monogram).
// It is not in @lobehub/icons, so render the mark inline. Fixed off-white
// fill on a dark badge background (see .agent-logo[data-source='pi']);
// no light/dark variants by design.
function PiMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 800 800" role="img" aria-label="Pi">
      {/* P shape: outer boundary clockwise, inner hole counter-clockwise */}
      <path
        fill="#f4f5f6"
        fillRule="evenodd"
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
      />
      {/* i dot */}
      <path fill="#f4f5f6" d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </svg>
  )
}

export function AgentGlyph({ source }: { source: AgentSource }) {
  const iconProps = { size: 16 }
  const icon = {
    codex: <CodexIcon {...iconProps} />,
    claude: <ClaudeCodeIcon {...iconProps} />,
    cursor: <CursorIcon {...iconProps} />,
    gemini: <GeminiIcon {...iconProps} />,
    opencode: <OpenCodeIcon {...iconProps} />,
    pi: <PiMark {...iconProps} />,
    custom: <Bot className="size-4" />,
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
