cask "clean-my-agent" do
  version "0.1.3"
  sha256 "5c06f8b5a7dc87042534d22a9f6365de0b98882e2dc67e01eae980028d5dd24f"

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
