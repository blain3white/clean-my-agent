cask "clean-my-agent" do
  version "0.1.4"
  sha256 "7e9a5eba30bb488f098ee155c6c08d6e0690dc20f57d7c40355d5d038055b01e"

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
