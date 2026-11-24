# Agent maintenance guide

Read docs/public/PROJECT_PLAN.md, README.md, ROADMAP.md, docs/public/ARCHITECTURE.md and docs/public/MAINTENANCE.md before changing code. The owner makes product and release decisions. Work autonomously within the requested scope and verify concrete results.

- Explain progress in Chinese for beginners with limited budgets.
- Current priority is desktop basics in PROJECT_PLAN.md v2.1: control security, conversation bubbles, audio-driven mouth and basic expressions, daily controls, model adaptation and reproducible builds. Virtual streaming, singing and viewer memory are deferred; do not treat plans as implementation. One character first; no multi-character co-stage.
- Preserve ordinary Chinese AI dialogue and the accepted private D voice reference. Reference synthesis is not model training. Do not switch voices automatically.
- Preserve source models; validate imports and use independent copies. Generic mode only drives existing parameters within runtime ranges. Model-specific keys belong in explicit adapters.
- Never publish models, textures, PSDs, private binaries, voice weights/recordings, credentials, profiles or logs. Respect .gitignore and run tools/check_publication.py before pushing. Private handoffs stay out of Git.
- Review licenses before reuse; pin upstream sources and retain attribution. Public code is not automatically MIT. Do not copy closed-source commercial code.
- source/desktop-v1.1.0 contains maintained engine changes. Update tools/setup.py PATCHES for deployed files. Do not switch to Native Beta without evidence and a reproducible build path.
- Keep baseline operation offline and cloud services optional. Do not alter global Agent configuration, startup items or system security as side effects.
- Normal use must not open a debugging port. Temporary acceptance uses 9237; restart normally afterward.
- Use appropriate tests. UI/audio/GPU/sleep/long-running claims need observations, not syntax checks or a surviving process. Update public documents with actual behavior and limits.
- Do not start subagents, broadcasts, recurring automation or new paid services without applicable owner authorization.

- Current owner preference: develop, test and save versions locally. Do not push to GitHub or create PRs unless the owner explicitly requests it again.

- The owner removed Haru. Do not import, restore, download or launch Haru/sample characters for default acceptance. Use the current DeepSeek character; generic logic uses synthetic unit fixtures unless the owner explicitly selects another model.

- Work autonomously within the selected scope and keep progress/final reports concise. Avoid redundant reads, model calls and repeated checks after passing validation; preserve the same implementation and verification standard.

- Own runtime modules live in companion/. source/desktop-v1.1.0 is the maintained upstream-derived integration/engine tree. Update tools/setup.py for both source roots. See docs/public/BUILD.md and upstream/README.md; CI verifies upstream provenance.
