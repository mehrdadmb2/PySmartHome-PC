name: "Release v$RESOLVED_VERSION"
tag: "v$RESOLVED_VERSION"
target: "main"
draft: false
prerelease: false

changelog:
  categories:
    - title: "🚀 Features"
      labels:
        - "feature"
        - "enhancement"
    - title: "🐛 Bug Fixes"
      labels:
        - "fix"
        - "bugfix"
        - "bug"
    - title: "📚 Documentation"
      labels:
        - "documentation"
        - "docs"
    - title: "🔒 Security"
      labels:
        - "security"
    - title: "🧪 Tests"
      labels:
        - "test"
        - "testing"
    - title: "🔧 Maintenance"
      labels:
        - "chore"
        - "refactor"
        - "dependencies"
    - title: "Other Changes"
      labels:
        - "*"