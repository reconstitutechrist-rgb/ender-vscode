# Ender - AI Coding Assistant

**Multi-agent AI coding assistant powered by Claude** with 14 specialized agents, 29 validators, and comprehensive safety features designed for developers of all skill levels.

## Features

### 🤖 14 Specialized Agents

- **Conductor** - Orchestrates all other agents and routes tasks
- **Planner** - Creates detailed implementation plans
- **Coder** - Implements code changes
- **Reviewer** - Reviews code quality with 29 validators
- **Documenter** - Generates documentation
- **Researcher** - Looks up information and documentation
- **Tester** - Generates and runs tests
- **Debugger** - Diagnoses and fixes issues
- **Git Manager** - Handles version control
- **Memory Keeper** - Maintains project memory
- **Hooks Agent** - Validates framework hooks
- **Integrations Agent** - Manages third-party integrations
- **Infrastructure Agent** - Handles deployment configs
- **Sanity Checker** - Catches AI-specific mistakes

### ✅ 29 Validators

Comprehensive code validation across 6 stages:

1. **Scope Validation** - Ensures changes match approved plans
2. **Code Quality** - Syntax, best practices, security scanning
3. **Integrity Checks** - Type safety, imports, test preservation
4. **Plan Compliance** - Breaking changes, snapshot comparison
5. **Specialist** - Hooks, integrations, infrastructure validation
6. **AI Accuracy** - Hallucination detection, style matching, edge cases

### 🧠 Intelligent Memory System

- **Auto-Learning** - Automatically captures project decisions
- **User Confirmation** - All auto-learned items require your approval
- **Tiered Storage** - Hot/warm/cold memory for optimal performance
- **Export/Import** - Portable memory across projects

### 🛡️ Safety Features

- **Show Your Work Mode** - See step-by-step reasoning
- **Assumption Log** - Track and verify all assumptions
- **Verification Checkpoints** - Pause at critical points
- **Rollback on Failure** - Automatic restoration if tests fail
- **Diff Explanation** - Plain English change explanations
- **Destructive Operation Prompts** - Extra confirmation for risky actions
- **Instruction Tracker** - Visual compliance monitoring

## Getting Started

1. Install the extension
2. Open a project folder
3. Configure your Anthropic API key (Settings > Ender > API Key)
4. Open the Ender chat panel (Ctrl+Shift+E / Cmd+Shift+E)
5. Start coding with AI assistance!

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Open Ender Chat | `Ctrl+Shift+E` | Open the chat panel |
| Undo Last Change | `Ctrl+Shift+Z` | Revert the last Ender change |
| View Memory | - | Browse project memory |
| Export Memory | - | Export memory to JSON |
| Import Memory | - | Import memory from JSON |
| Toggle Strict Mode | - | Switch between strict/fast validation |

## Configuration

### Global Settings

Configure in VS Code Settings:

- `ender.apiKey` - Your Anthropic API key
- `ender.approvalMode` - automatic, manual, or hybrid
- `ender.confidenceThreshold` - Minimum confidence for auto-approval (0-100)
- `ender.validatorMode` - strict, fast, or custom
- `ender.showAgentIndicator` - Show which agent is working
- `ender.showCostTracker` - Display API cost tracking

### Project Settings

Create `.ender/config.json` in your project:

```json
{
  "version": "1.0.0",
  "projectName": "My App",
  "techStack": ["typescript", "react", "node"],
  "behavior": {
    "verbosity": "detailed",
    "codingStyle": "functional"
  },
  "customRules": [
    "Always use named exports",
    "Use absolute imports with @/ prefix"
  ],
  "costLimits": {
    "dailyBudget": 10.00,
    "monthlyBudget": 100.00
  }
}
```

## Approval Workflow

Ender supports flexible approval:

- **Automatic** - Changes applied without confirmation
- **Manual** - Every change requires approval
- **Hybrid** - Auto-approve high-confidence, manual for low

Approval granularity:
- Entire plan
- Per phase
- Per file
- Any combination

## Model Routing

Ender intelligently routes tasks to the optimal model:

- **Claude Opus 4.5** - Complex tasks, self-review, architecture decisions
- **Claude Sonnet 4.5** - Simple tasks, documentation, quick fixes

## Requirements

- VS Code 1.85.0 or higher
- Node.js 18 or higher
- Anthropic API key

## Privacy

- All data stays local in your `.ender` folder
- API calls go directly to Anthropic
- Optional anonymous telemetry (disabled by default)

## License

MIT

## Support

- [GitHub Issues](https://github.com/ender-ai/ender-vscode/issues)
- [Documentation](https://github.com/ender-ai/ender-vscode/wiki)
