# CLAUDE.md

## 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them.
- Prefer simpler solutions.
- If unclear, stop and clarify.

## 2. Simplicity & Conventions
**Minimum code that solves the problem. Nothing speculative.**
- Build only what was requested.
- No YAGNI: no speculative features or abstractions.
- Follow existing patterns.
- Use short clear names and verb-based functions.
- If overengineered, simplify.

## 3. Data & Safety Rules
- Do not use `any` (TS) or `dynamic` (C#).
- Public APIs / services must return explicit models.
- Check for manual user edits before changes.
- Never overwrite user changes without confirmation.
- Keep diffs minimal and preserve logic.

## 4. Workflow & Output
- Workflow: AI receives the request → Analyzes the requirements → Presents the plan to the user → Executes only after the user confirms the plan
- Report briefly: What changed, Why, Check result
- Never claim completion before checks pass.
