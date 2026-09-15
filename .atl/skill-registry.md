# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| New project, iteration planning, full-flow development | vertical-slices | /home/julion/.config/opencode/skills/vertical-slices/SKILL.md |
| Writing Go tests, teatest, Bubbletea TUI testing | go-testing | /home/julion/.config/opencode/skills/go-testing/SKILL.md |
| Next.js routing, Server Actions, data fetching | nextjs-15 | /home/julion/.config/opencode/skills/nextjs-15/SKILL.md |
| Proposals, specs, design, tasks, critical review | design-critic | /home/julion/.config/opencode/skills/design-critic/SKILL.md |
| Create a new skill, add agent instructions | skill-creator | /home/julion/.config/opencode/skills/skill-creator/SKILL.md |
| Writing TypeScript code — types, interfaces, generics | typescript | /home/julion/.config/opencode/skills/typescript/SKILL.md |
| "judgment day", adversarial review, dual review | judgment-day | /home/julion/.config/opencode/skills/judgment-day/SKILL.md |
| GitHub issue, bug report, feature request | issue-creation | /home/julion/.config/opencode/skills/issue-creation/SKILL.md |
| Writing React components, React Compiler | react-19 | /home/julion/.config/opencode/skills/react-19/SKILL.md |
| Writing E2E tests, Page Objects, selectors | playwright | /home/julion/.config/opencode/skills/playwright/SKILL.md |
| Security, APIs, integrations, testing, code review, explicit audit | code-auditor | /home/julion/.config/opencode/skills/code-auditor/SKILL.md |
| Creating a pull request, opening a PR | branch-pr | /home/julion/.config/opencode/skills/branch-pr/SKILL.md |
| Browser automation, test web pages, Playwright tests | playwright-cli | /home/julion/.claude/skills/playwright-cli/SKILL.md |
| Saving discoveries/decisions, "remember", "recall" | engram-memory | /home/julion/.agents/skills/engram-memory/SKILL.md |
| Creating/unifying a GitHub Pages evidence dashboard (lab, experimento, proyecto rápido, herramienta) | dashboard-pages | /home/julion/.config/opencode/skills/dashboard-pages/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### typescript
- Const types pattern REQUIRED: create `const X = {...} as const` first, then `type T = (typeof X)[keyof typeof X]` — never bare string unions
- Flat interfaces: one level depth; nested objects get their own dedicated interface, referenced not inlined
- NEVER use `any` — use `unknown` with type guards (`value is T`), or generics
- Use utility types: `Pick`, `Omit`, `Partial`, `Required`, `Record`, `Extract`, `Exclude`, `NonNullable`, `ReturnType<typeof fn>`, `Parameters<typeof fn>`
- Use `import type { X }` for type-only imports

### code-auditor
- Complementary, NOT a blocker: reports findings with severity, suggests fixes, never stops the flow
- Severity: CRITICAL → fix now (vuln/data leak/breaking); WARNING → fix soon; SUGGESTION → optional; INFO → context
- Auto-activates on: auth (JWT/sessions), user input handling, DB queries/migrations, external APIs, secrets, file handling, testing, code review
- SQL injection: always parameterized queries (no string concatenation)
- JWT: use `jwt.verify`, never `jwt.decode` alone; check `exp` after verify
- Never log secrets (API keys, tokens, passwords)

### design-critic
- NEVER assume — if something is not explicit, it's a question; ask before proceeding
- Always question decisions: "¿Por qué X y no Y?"
- Detect gaps and coherence: "Esto no cubre Z", "Esto contradice lo anterior"
- Findings: ❓ PREGUNTA (blocks if critical), ⚠️ SEÑALAMIENTO, 🔍 SUPUESTO, 📐 COHERENCIA, 💡 SUGERENCIA
- Active per SDD phase: propose (intent/scope), spec (edge cases/measurable criteria), design (trade-offs), tasks (validation gaps/priority), apply (spec compliance)

### vertical-slices
- Each iteration delivers a complete, functional, verifiable, integrable flow — NO layered builds, NO integration debt
- Module structure: routes → controller (orchestration only) → service (business logic, pure functions) → repository (data access) → dto (validation contract) → tests
- Constraints: no business logic in controllers (max 10–15 lines/endpoint); no direct DB access outside repository; services framework-independent (reusable in CLI/workers)
- Multi-tenant: `client_id` present in EVERY query, injected from auth middleware; tests must verify cross-tenant isolation
- Contract defined BEFORE code; explicit exit criteria per phase
- NOT for simple scripts/utilities or single-file prototypes (lab experiments are scripts — use sparingly)

### engram-memory
- Save PROACTIVELY after decisions, bug fixes, discoveries, conventions — do not wait to be asked
- Content format: `**What**: ... **Why**: ... **Where**: ... **Learned**: ...` (omit Learned if none)
- Types: decision | bugfix | architecture | pattern | discovery | config
- Use `topic_key` for evolving topics (upserts instead of duplicates); search with `mem_search` before starting related work
- On user says "remember/recall/recordar/qué hicimos" → `mem_context` first, then `mem_search` if not found
- Before ending session: `mem_session_summary` with Goal/Instructions/Discoveries/Accomplished/Next Steps/Relevant Files

### playwright-cli
- CLI browser automation: `playwright-cli open|goto|click|type|fill|snapshot|eval|close`
- Interact using refs from snapshot (e.g. `playwright-cli click e15`); use `eval` to get attributes not visible in snapshot
- `--submit` on `fill` presses Enter after filling; `dialog-accept`/`dialog-dismiss` handle dialogs; `resize 1920 1080` sets viewport

### react-19
- No useMemo/useCallback — React Compiler handles memoization automatically
- `use()` hook for promises/context (replaces useEffect for data fetching in some cases)
- Server Components by default; add `'use client'` only for interactivity/hooks
- `ref` is a regular prop — no `forwardRef` needed
- Forms/mutations: `useActionState` for mutations, `useOptimistic` for optimistic UI
- Metadata: export `metadata` object from page/layout, no `<Head>` component

### nextjs-15
- App Router: file-based routing (page.tsx, layout.tsx, route.ts, not-found.tsx, loading.tsx)
- Server Actions for mutations (async functions with 'use server'); prefer them over API routes when possible
- Data fetching: Server Components fetch directly; use `cache()`, `revalidatePath`, `unstable_cache` for caching
- Client Components only for interactive parts; keep the rest server-side
- Params/query: `params` is a Promise in Next 15 — await it before reading

### playwright
- E2E: use Page Objects for maintainability; keep selectors stable (data-testid preferred)
- Follow the MCP workflow for tests against live apps; snapshot-based interaction when possible
- Write tests that assert user-visible behavior, not implementation details

### go-testing
- Go testing patterns for Gentleman.Dots: table-driven tests, `go test` built-in runner
- Bubbletea TUI testing via teatest; test models by sending messages and asserting view/state

### skill-creator
- Creates new AI agent skills following the Agent Skills spec
- Skills need frontmatter: name, description (with Trigger: line), metadata (author/version)
- Place at ~/.config/opencode/skills/<name>/SKILL.md (or project-level for project-specific skills)

### branch-pr
- PR creation workflow following issue-first enforcement: create/link the GitHub issue before opening the PR
- PR description references the issue and summarizes changes with evidence

### issue-creation
- Issue creation workflow following issue-first enforcement system
- Issues are the entry point: bug reports and feature requests become issues before any PR

### judgment-day
- Parallel adversarial review: two independent blind judge sub-agents review the same target simultaneously
- Synthesize findings, apply fixes, re-judge until both pass or escalate after 2 iterations

### dashboard-pages
- ONE dashboard version per project — NEVER coexist a single-file `dashboard.html` AND a `dashboard/` folder with the same page
- Pages root `docs/index.html` MUST always reach the interactive version via relative redirect (`meta refresh` to `./dashboard/` or `./dashboard.html`)
- Zero CDN, zero build step, zero absolute paths — all relative so it works on `file://` and Pages
- Simulations run client-side (inline `<script>` or local `app.js`); evidence embedded or in `docs/output-*.txt`
- Commit EVERYTHING the dashboard documents (`docs/simulators/`, `docs/evidence/`) — untracked files don't deploy to Pages
- GitHub Pages legacy (`main` → `/docs`) serves `docs/index.html`; relative `meta refresh` is enough, no `.nojekyll` needed

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| (none found at project root) | — | No AGENTS.md / CLAUDE.md / .cursorrules / GEMINI.md / copilot-instructions.md in temporada-1 root |

User-level convention file (always injected by the runtime, applies to this project):
| AGENTS.md (global) | /home/julion/.config/opencode/AGENTS.md | Gentle AI ecosystem, neutral Spanish (no voseo), Engram protocol, available agents/skills |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.