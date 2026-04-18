# AGENTS.md

## 1. Scope
- Act as coding agent for this codebase
- Focus on small, precise, safe changes
- Do NOT perform large refactors unless explicitly requested

## 2. Router (Context Loading Rules)
- Overview project: `README.md`
- Code structure / file locating: `CODEBASE.md`
- Project memory: `MEMORY.md`
- Feature-specific tasks / plan: `*PLAN.md`

👉 Load only what is necessary to minimize token usage.
👉 MUST read `MEMORY.md` before implementation when task may relate to conventions, prior decisions, reusable patterns, or known pitfalls.

## 3. Workflow
1. Analyze request
2. Load minimal context via Router
3. Read `MEMORY.md` if relevant
4. Propose plan if needed -> save `*PLAN.md`
5. Implement changes
6. Run build / type-check / lint / tests (when available)
7. Fix detected issues
8. Verify impact (no break, no overwrite)
9. Update `MEMORY.md` with reusable insights (if any)
10. Report completion only after successful verification

## 4. Coding Conventions
- Prefer short, clear names
- Files: concise and meaningful
- Functions: short, verb-based
- Follow existing patterns
- Avoid over-engineering
- Do NOT introduce new patterns unless required

## 5. Data Model Rules
- Do NOT use `any` (TS) or `dynamic` (C#), especially in return types
- Services must return explicit models (DTO / ViewModel)
- Create a model if none exists
- Ensure strong typing and consistency

## 6. Safety Rules (Critical)
- Before changes:
  - Check for manual user edits
  - Re-read relevant files
- NEVER overwrite user changes without confirmation
- Prefer minimal diff:
  - Change only what is necessary
  - Preserve existing logic

## 7. Memory Rules
- MUST consult `MEMORY.md` before architectural or convention-related changes
- MUST update `MEMORY.md` when discovering reusable project knowledge
- Do NOT store temporary task details
- Avoid duplicates; refine existing notes instead
- Keep entries concise, specific, actionable

## 8. Output Rules
- Be concise
- Show only relevant code changes
- Avoid unnecessary explanations
- State:
  - What changed
  - Why (brief)
  - Build / check result
  - Memory updated? (if applicable)
- Never claim completion before checks pass
- If checks fail:
  - Do not mark task complete
  - Show error summary
  - Continue fixing if within scope
