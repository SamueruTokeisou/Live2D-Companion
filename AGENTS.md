# Agent maintenance guide

Read docs/public/PROJECT_PLAN.md, README.md, ROADMAP.md, docs/public/ARCHITECTURE.md and docs/public/MAINTENANCE.md before changing code. The repository owner makes product and release decisions; work autonomously within the requested scope and verify concrete results.

- Explain progress in Chinese for a beginner with a limited budget. Prefer usable demonstrations and small complete changes over additional planning layers.
- Current product direction (owner decision 2026-11-24): build a single-character AI virtual streamer with audience conversation, speech/body performance, singing and song requests, session/day memory and separate supporter/viewer profiles. The desktop pet remains a mode.
- The authoritative roadmap is PROJECT_PLAN.md v2 R0–R6. Old P1–P8 documents are historical evidence, not the current execution order. Planning is not implementation.
- Prioritize A01 local control security and A03/A04 streamer demonstration. Incomplete optional hardware coverage must not block a local demonstration; known control, data isolation and stop failures must block unattended public streaming.
- Memory is now explicitly selected by the owner, superseding the prior deferral. Implement session memory before per-viewer long-term records. Key identities by platform/room/UID, preserve provenance/expiry/deletion, and separate payment entitlements from personal facts. Do not claim memory exists before implementation.
- Keep desktop dialogue ordinary; streamer mode adds factual role, audience, program and capability context. Voice identity must not inject an anime persona. Do not grant operator permissions from audience text.
- Current accepted voice is Chinese audition D. Keep Chinese replies/subtitles and the selected private reference; do not switch references automatically. Prefer steady references without obvious interjections/laughter. Reference synthesis is not model training.
- Reuse mature code and protocols proactively when suitable. Check code, frontend, model and asset licenses separately; pin sources, retain attribution, and do not copy closed-source commercial code or assume public availability means MIT.
- source/desktop-v1.1.0 remains the maintained engine source. Update tools/setup.py PATCHES for deployed files. Upstream/self-owned module separation is a migration target, not an already-completed fact.
- Preserve source models. Imports validate references and use independent local copies. Generic mode only drives existing parameters within runtime ranges; model-specific behavior belongs in an explicit adapter.
- Never publish models, PSDs, textures, private runtime binaries, voice weights/recordings, credentials, viewer profiles, payments or user logs. Respect .gitignore; run tools/check_publication.py before pushing. Private handoff files stay out of Git.
- Preserve the pinned runtime until an alternative has evidence and a reproducible source/build path. Do not switch to Native Beta or claim a source-built release merely because a pack script exists.
- Keep baseline desktop operation offline and cloud services optional. No global Agent, startup-item or system security changes as side effects. New paid usage, actual public streaming and publication need concrete applicable owner authorization.
- Normal operation must not open a debugging port. Temporary acceptance tooling uses 9237 and must restart normally afterward.
- Test according to the change. UI/audio/GPU/OBS/sleep/long-running claims require observations. Keep historical validation and current limitations accurate without letting unrelated future checks prevent current authorized work.
- Do not train or run several heavy inference jobs simultaneously during a stream on the 8GB reference machine. Prepared singing audio and explicit worker start/stop are preferred early.
- Do not automatically start subagents, public broadcasts, recurring automation or paid services merely because an external review recommends them.
