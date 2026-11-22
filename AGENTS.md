# Agent maintenance guide

Read README.md, ROADMAP.md, docs/public/ARCHITECTURE.md and docs/public/MAINTENANCE.md before changing code. The repository owner makes product and release decisions; work autonomously within the requested task and verify concrete results.

- Explain progress in Chinese unless the user requests otherwise. The intended audience includes beginners with limited budgets.
- Preserve source models. Imports must validate references and operate on independent local copies.
- Never publish models, PSDs, textures, private runtime binaries, voice weights, credentials, local profiles or user logs. Respect .gitignore and run tools/check_publication.py before pushing.
- Retain upstream license and attribution. Review licenses before copying external code; public availability does not imply MIT permission.
- source/desktop-v1.1.0 contains the maintained engine changes. tools/setup.py lists deployment patches; update the list when changing a deployed file.
- Do not switch the default runtime to Native Beta without evidence and a reproducible source/build path.
- Keep baseline operation offline and cloud services optional. Do not change global Agent configuration, startup items or system security settings as a side effect.
- Use tests appropriate to each change. UI, GPU, sleep/resume and long-running claims need actual observations, not just syntax checks or a surviving process.
- Normal use must not open a debugging port. Temporary acceptance tooling uses 9237; restart normally when done.
- Generic mode must only drive parameters that exist, within their runtime ranges. Model-specific behavior belongs in an explicit adapter.
- Update public documentation with final behavior and limitations. Keep private machine handoff files out of Git.

- Current product preference: prioritize one character. Multi-character co-stage is outside the current roadmap. External-project ideas are deferred research unless the user selects them for implementation.
