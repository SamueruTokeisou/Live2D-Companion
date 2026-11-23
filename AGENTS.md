# Agent maintenance guide

Read docs/public/PROJECT_PLAN.md, README.md, ROADMAP.md, docs/public/ARCHITECTURE.md and docs/public/MAINTENANCE.md before changing code. The repository owner makes product and release decisions; work autonomously within the requested task and verify concrete results.

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

- Owner decision 2026-11-23: use ordinary AI conversation without added fixed personality, persona profiles, long-term memory, user profiling or automatic summaries. P4 controlled memory is deferred and removed as a prerequisite; retain only P3 in-process recent context. Do not reintroduce memory without an explicit owner request.
- The active implementation order is P1 runtime foundation, P2 event kernel, P3 text conversation, P5 voice, P6 body workbench, P7 companion features, P8 release. Phase gates in PROJECT_PLAN.md are authoritative. Do not treat the plan as completed implementation.

- Owner decision 2026-11-23: allow Chinese input, respond in Japanese with Japanese-only reply subtitles. GPT-SoVITS is the selected optional local voice route. Erio-style voice is a private reference direction, never a fixed persona. Do not publish recordings or claim voice similarity without listening evidence.

- Superseding owner decision 2026-11-23: switch to Chinese replies, Chinese subtitles and Chinese speech. Current voice candidate is Ayaka's Chinese performance (XiaoN). Previous Erio audition was rejected for poor quality; keep speech disabled until the new audition is accepted. Voice identity must not inject character personality.

- Owner listening decision 2026-11-23: Chinese voice audition A was preferred as more natural. Use A as the current trial voice; do not replace it with B based only on ASR. Chinese speech may now be enabled with the selected private reference.

- Latest owner request 2026-11-23: A was unsatisfactory in actual Chinese dialogue; switch to Chinese audition B for another trial, with speech enabled. This is a trial, not final quality acceptance. Old Japanese references are retired; do not delete shared engine/base weights or Chinese A/B assets.
