cask "clean-my-agent" do
  version "0.1.5"
  sha256 "e88206c196188dc2c68f1dc97ec8fde56b08c0727834d51b6f05bc252dc1743f"

  url "https://github.com/blain3white/clean-my-agent/releases/download/v#{version}/Clean-My-Agent-mac-arm64.dmg",
      verified: "github.com/blain3white/clean-my-agent/"
  name "Clean My Agent"
  desc "Clean, back up, and move your AI coding sessions"
  homepage "https://github.com/blain3white/clean-my-agent"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64

  app "Clean My Agent.app"

  zap trash: [
    "~/Library/Application Support/Clean My Agent",
    "~/Library/Logs/Clean My Agent",
    "~/Library/Preferences/com.cleanmyagent.app.plist",
    "~/Library/Saved Application State/com.cleanmyagent.app.savedState",
  ]
end
