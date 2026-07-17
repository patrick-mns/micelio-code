# Changelog

## [0.15.3](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.15.2...micelio-v0.15.3) (2026-07-17)


### Bug Fixes

* **review:** scope the changes panel to the selected folder ([c862795](https://github.com/patrick-mns/micelio-code/commit/c8627956e1d4a912ec4257a9d8250972e123ff5f))
* **review:** scope the changes panel to the selected folder ([f0e3172](https://github.com/patrick-mns/micelio-code/commit/f0e317265ca981b5dc91db40335e1abe9910c1f5))

## [0.15.2](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.15.1...micelio-v0.15.2) (2026-07-16)


### Bug Fixes

* **agent:** never end a turn without a reply ([f86bab8](https://github.com/patrick-mns/micelio-code/commit/f86bab8a0bafb80c12f571a8586419cce87b6d9e))
* chat persistence, cancel feedback, empty-turn replies, and folder label ([eebceec](https://github.com/patrick-mns/micelio-code/commit/eebceecc0015358d124286d526e16b8eed54d964))
* **chat:** give immediate feedback when canceling a stream ([e58b04b](https://github.com/patrick-mns/micelio-code/commit/e58b04bf4a71683d8fec742ee0451689d4c666fb))
* **chat:** jump to the bottom when the user sends a message ([5909860](https://github.com/patrick-mns/micelio-code/commit/59098601be9a8fa3d12fb5b8692676064a919aa7))
* **chat:** persist partial assistant output when a turn fails ([b2a3b63](https://github.com/patrick-mns/micelio-code/commit/b2a3b63dff8e6e39d304f13c40ad389fa98dc8cf))
* **gitcontext:** show folder name as a static label for single-folder workspaces ([d6f7360](https://github.com/patrick-mns/micelio-code/commit/d6f7360ac05bf46cfe53d3d8a885771376f72216))

## [0.15.1](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.15.0...micelio-v0.15.1) (2026-07-16)


### Bug Fixes

* **chat:** follow streaming output past the virtualized viewport ([c1f38b5](https://github.com/patrick-mns/micelio-code/commit/c1f38b5959be542325d80f043af2aeb7e0444538))
* **graph:** stop nesting one folder's tree inside another's ([0e1eff0](https://github.com/patrick-mns/micelio-code/commit/0e1eff07ec8610bb1b5acae2a6da90e8086ef309))
* treemap folder scoping, graph nesting, and chat auto-scroll ([0596983](https://github.com/patrick-mns/micelio-code/commit/0596983d38032aeb4f80672f67d386b1fb437451))
* **treemap:** keep folder scoping in sync with the active workspace ([287fcb7](https://github.com/patrick-mns/micelio-code/commit/287fcb7fbc44e215206984e961b955499fc20a3c))
* **treemap:** stop blanking the map when switching folders ([114a315](https://github.com/patrick-mns/micelio-code/commit/114a3154e69caed1d0fc32d0538fff0dd4845046))

## [0.15.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.14.0...micelio-v0.15.0) (2026-07-16)


### Features

* merge dev into main for release v0.15.0 ([e267d80](https://github.com/patrick-mns/micelio-code/commit/e267d80038ae120f26061bcd0982843f584faed7))
* **ui:** move Usage panel into Settings modal ([681061a](https://github.com/patrick-mns/micelio-code/commit/681061a2d66df07bbf7f65182ad41c7bb30f4543))

## [0.14.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.13.1...micelio-v0.14.0) (2026-07-16)


### Features

* **terminal:** run agent commands in an OS sandbox (Seatbelt/bubblewrap) ([8f37856](https://github.com/patrick-mns/micelio-code/commit/8f37856fdb42d460e9ee272de504658e7c409c79))
* **terminal:** run agent commands in an OS sandbox (Seatbelt/bubblewrap) ([1b1b46f](https://github.com/patrick-mns/micelio-code/commit/1b1b46f6a5f676e4f1b5bda6a48b505eed65e7bf))


### Bug Fixes

* **terminal:** gate the sandbox test module and cmd import per-target ([e5e7dff](https://github.com/patrick-mns/micelio-code/commit/e5e7dffe6a5e4e71bf051217e1b761ff4d953416))
* **windows:** stop console windows from flashing on editor/opener spawns ([1a0a9d1](https://github.com/patrick-mns/micelio-code/commit/1a0a9d1b3f7855fe36b439dc8891b6b953c1603a))
* **windows:** stop console windows from flashing on editor/opener spawns ([1297232](https://github.com/patrick-mns/micelio-code/commit/129723276ffb52e1f38913fc6085267529e97943))

## [0.13.1](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.13.0...micelio-v0.13.1) (2026-07-16)


### Bug Fixes

* **ci:** add build targets to the pinned toolchain, not the default one ([15e3d51](https://github.com/patrick-mns/micelio-code/commit/15e3d51ef4a79a9402dc65c159c52d8347c20d55))
* **ci:** add build targets to the pinned toolchain, not the default one ([0ee8396](https://github.com/patrick-mns/micelio-code/commit/0ee83960dfef29ae621f212d65a4e27719320c54))

## [0.13.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.12.0...micelio-v0.13.0) (2026-07-16)


### Features

* **chat:** add toggle to show which model produced each reply ([3f36664](https://github.com/patrick-mns/micelio-code/commit/3f36664f87c8860c55962f1e5ba81ab741df38a3))
* disable mode and model selectors while turn is running ([6082941](https://github.com/patrick-mns/micelio-code/commit/6082941de8f182dfcf4d60971f565c27268e181a))
* **locks:** lock files so the agent sees them but can't read them ([4687039](https://github.com/patrick-mns/micelio-code/commit/4687039e46845200787e919437d7510bc45569c6))


### Bug Fixes

* **chat:** stop tool groups from collapsing mid-stream ([d82ea34](https://github.com/patrick-mns/micelio-code/commit/d82ea3483712bfd9e8ca4a77466b9ed10fa1d65a))
* **ci:** pin the Rust toolchain and fix a lint from the newer one ([a784279](https://github.com/patrick-mns/micelio-code/commit/a7842793c830df0d0754e78b05852d43d456daaa))
* **ollama:** escape control characters and reject stray surrogates ([c44ef53](https://github.com/patrick-mns/micelio-code/commit/c44ef53644c7174d8617aaac5c0f4fd3702122db))
* **sessions:** clear usage by marking rows, not by timestamp cutoff ([4700ab4](https://github.com/patrick-mns/micelio-code/commit/4700ab4492bebd2ceddf4fac4ad0afc11babaf9c))


### Performance Improvements

* **ui:** virtualize the node modal's code viewer ([85b1aa0](https://github.com/patrick-mns/micelio-code/commit/85b1aa0b90684f4733cde4643f0a9aa371896606))

## [0.12.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.11.0...micelio-v0.12.0) (2026-07-15)


### Features

* **bg:** show source folder, order newest-first, and cap finished tasks ([7daec8d](https://github.com/patrick-mns/micelio-code/commit/7daec8d2d9d9cd45b4bbf04a4ccbdfb4138c8289))
* **providers:** configurable OpenAI-compatible endpoints ([40ed8da](https://github.com/patrick-mns/micelio-code/commit/40ed8da8421ae3e5ce8922f37c35aba4cf9b1750))
* **skills:** hot-reload skills via filesystem watcher ([b8d26dc](https://github.com/patrick-mns/micelio-code/commit/b8d26dc02ec60054942c930e9e846a68cca9b05b))
* **ui:** show active session badge in header and load session on startup ([792f422](https://github.com/patrick-mns/micelio-code/commit/792f422df7b7a6f5612d78358fb70e39f675aebe))


### Bug Fixes

* **bg:** delete task logs when tasks leave the registry ([2c0d451](https://github.com/patrick-mns/micelio-code/commit/2c0d451d6aa819874077a692d53eda812c38626f))
* **git:** count staged and untracked changes in badge and changes panel ([9eb98a8](https://github.com/patrick-mns/micelio-code/commit/9eb98a8f2f94cb3f4a6a671629806a0a24fdaef2))
* **git:** match per-file changes counts to git via LCS diff ([514f78f](https://github.com/patrick-mns/micelio-code/commit/514f78f362cb53855d8d93a9bba13a47ccd58351))
* **git:** revert of a new file removes it in the changes panel ([fc055f2](https://github.com/patrick-mns/micelio-code/commit/fc055f2850776938c225079412f6f7922c99751a))
* **ui:** render native controls in the app theme ([66b6d18](https://github.com/patrick-mns/micelio-code/commit/66b6d18e552853bd0b9dae3ee54feebcfe0a9599))


### Performance Improvements

* **ui:** virtualize chat message list to fix long-context jank ([506a6da](https://github.com/patrick-mns/micelio-code/commit/506a6daeb8d8275078e970c2d28f94366c388b8c))

## [0.11.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.10.0...micelio-v0.11.0) (2026-07-14)


### Features

* skills system — workspace skill dock, #mentions, built-in skills ([7ccbbfe](https://github.com/patrick-mns/micelio-code/commit/7ccbbfed8e515cc19779eb237b1e052fcfccab7c))


### Bug Fixes

* sha256 hex formatting compat with latest sha2 crate ([c249158](https://github.com/patrick-mns/micelio-code/commit/c2491588e24de136163c7a3a9ffdcba548cba560))

## [0.10.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.9.0...micelio-v0.10.0) (2026-07-14)


### Features

* skills system, MCP client, and review mode ([252a325](https://github.com/patrick-mns/micelio-code/commit/252a325329b2ae0c45a5a8fb2e60d17d033082f2))
* **skills:** also load skills from .agents and .github ([435a9a8](https://github.com/patrick-mns/micelio-code/commit/435a9a8ac41b4d4b7d5c7fc7fa8bad53388199de))
* **skills:** load Claude Code skills from .claude/skills ([277ee6a](https://github.com/patrick-mns/micelio-code/commit/277ee6a288f6a08bd4b7c5efdb6c0b39b8f8c94e))
* **skills:** ship built-in skills (skill-creator, commit) ([b3cc5f4](https://github.com/patrick-mns/micelio-code/commit/b3cc5f44a8f7aa786d5b85104d72d189eca3fb1c))
* **skills:** show active skills as a read-only section in the prompt inspector ([f7a9591](https://github.com/patrick-mns/micelio-code/commit/f7a9591d378a5b4a0717b88485a2b3a12af007fb))
* **skills:** workspace skills with dock, #mentions, and inspector ([0707612](https://github.com/patrick-mns/micelio-code/commit/0707612d20fd55d73fddb4386603b92a61482375))
* **skills:** workspace skills with dock, #mentions, and inspector modal ([796c9c8](https://github.com/patrick-mns/micelio-code/commit/796c9c8898bb9ce588897c02956a86bf7ca8e267))
* **ui:** increase ModeSelector dropdown to match ModelRolesSelector width ([bf272f5](https://github.com/patrick-mns/micelio-code/commit/bf272f5b07df82c666c6951339a8b7e20b1ff40d))


### Bug Fixes

* **ollama:** detect vision capability via ollama show ([6514dfe](https://github.com/patrick-mns/micelio-code/commit/6514dfe3fc73b5abd5ca92a45fb0e6b2ff5e34d1))
* **skills:** keep active skills out of the system prompt inspector ([052415f](https://github.com/patrick-mns/micelio-code/commit/052415f5b5e458c045de7c15a41aa11622b17060))
* **skills:** sort list_skills alphabetically so the dock order is stable ([d4c108d](https://github.com/patrick-mns/micelio-code/commit/d4c108db8fcc0cc69c93aec494c8f9169a603998))

## [0.9.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.8.0...micelio-v0.9.0) (2026-07-13)


### Features

* MCP client, Review confirmations, and UI fixes ([9b3c605](https://github.com/patrick-mns/micelio-code/commit/9b3c605018b0ec458962b3a115fc9a1f230944ed))

## [0.8.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.7.0...micelio-v0.8.0) (2026-07-11)


### Features

* read-only tools in Chat mode, header centering & sidebar fixes ([#35](https://github.com/patrick-mns/micelio-code/issues/35)) ([404011c](https://github.com/patrick-mns/micelio-code/commit/404011c4878ec84b93a5acce5468a5c967c22d03))

## [0.7.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.6.0...micelio-v0.7.0) (2026-07-11)


### Features

* **i18n:** add Portuguese language support with extended theming ([#30](https://github.com/patrick-mns/micelio-code/issues/30)) ([5eec7fd](https://github.com/patrick-mns/micelio-code/commit/5eec7fdc61d7cfffed2d7766357b8d163450856e))


### Bug Fixes

* **ui:** improve locale selector readability and unblock accent color on Dracula variant ([#32](https://github.com/patrick-mns/micelio-code/issues/32)) ([560c972](https://github.com/patrick-mns/micelio-code/commit/560c972c4b9d2116aba3eabbe38c3483dcd1e91e))

## [0.6.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.5.0...micelio-v0.6.0) (2026-07-10)


### Features

* agent modes, styled confirms, and workspace session fixes ([#28](https://github.com/patrick-mns/micelio-code/issues/28)) ([3ba34c1](https://github.com/patrick-mns/micelio-code/commit/3ba34c162cbade8da021b049148575611202d118))

## [0.5.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.4.0...micelio-v0.5.0) (2026-07-09)


### Features

* **app:** custom title bar for Windows and Linux ([0a25c80](https://github.com/patrick-mns/micelio-code/commit/0a25c805f692d220b62981cccd7b5e564879f55e))
* **ui:** render ask_user question text as markdown in QuestionCard ([926a603](https://github.com/patrick-mns/micelio-code/commit/926a603065014f1746a8704e027ee13cb933897d))


### Bug Fixes

* **chat:** honor "Show thinking" toggle in MessageList ([56502f7](https://github.com/patrick-mns/micelio-code/commit/56502f723a940fe525a5720c716f4e4cad58aa70))
* **chat:** honor "Show thinking" toggle in MessageList ([422d244](https://github.com/patrick-mns/micelio-code/commit/422d244bd5f48bc4462823a12889257d7da0d761))
* **treemap:** re-busca o grafo ao trocar de pasta ativa ([6180139](https://github.com/patrick-mns/micelio-code/commit/6180139a8ac0248357c3d5a679095952963865e0))
* **treemap:** re-fetch graph when switching active folder ([b7b4a63](https://github.com/patrick-mns/micelio-code/commit/b7b4a63f6baf39665d2c5a193e4a0933893c3d6c))
* **ui:** use btn-ghost variant for Reject button in EditApprovalCard ([cd590c4](https://github.com/patrick-mns/micelio-code/commit/cd590c4969fa92900e8445a32c525a5cf7d05739))

## [0.4.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.7...micelio-v0.4.0) (2026-07-09)


### Features

* **gitcontext:** folder selector dropdown from workspace folders ([6b8f447](https://github.com/patrick-mns/micelio-code/commit/6b8f4475681d29f7b539489bfba141be445800d7))
* **review:** inline per-edit approval instead of batch review panel ([7604ec4](https://github.com/patrick-mns/micelio-code/commit/7604ec4f829664aaa3b698453dbcf94eb99a7293))
* **review:** inline per-edit approval instead of batch review panel ([f62562c](https://github.com/patrick-mns/micelio-code/commit/f62562c9313f3e66b24f433fdde09cd9ad7cb1a9))
* **sidebar:** workspaces as collapsible groups with sessions ([0be56f9](https://github.com/patrick-mns/micelio-code/commit/0be56f9a5e6fb6aa3066a449e4d9ac1f40d62d7c))
* **ui:** group tools live during streaming as 'Ran N tools' ([ed8cee1](https://github.com/patrick-mns/micelio-code/commit/ed8cee1c8b327ded67b294c5dc0be18b35e422b1))
* **workspace:** allow empty "no workspace" state instead of a phantom default ([77d45e2](https://github.com/patrick-mns/micelio-code/commit/77d45e2e591edcce9ec43bfea013cd74d670bc22))
* **workspace:** delete workspace with backend command + frontend button ([3e7f849](https://github.com/patrick-mns/micelio-code/commit/3e7f8499a35e71729cdc1e265ea90139af537cf4))
* **workspace:** multi-root workspace — decouple chat from folder ([9cf0770](https://github.com/patrick-mns/micelio-code/commit/9cf077009db545f8d68246a9ab045d6007e98f6c))
* **workspace:** onboarding gate + settings as a plain management list ([3aef668](https://github.com/patrick-mns/micelio-code/commit/3aef668e6707f0a152a11ecc97e4b978f11dc46c))


### Bug Fixes

* **chat:** image attachment writes to wrong session on async FileReader load ([9078fdb](https://github.com/patrick-mns/micelio-code/commit/9078fdb6f91c57e6e2b6022076450713765b4363))
* **header:** keep Chat/Treemap/Usage switcher truly centered ([7359076](https://github.com/patrick-mns/micelio-code/commit/7359076eebebd81f53485b086c15af4ff43e6084))
* **header:** keep Chat/Treemap/Usage switcher truly centered ([1c92f37](https://github.com/patrick-mns/micelio-code/commit/1c92f37d1eb503a97de45aa873bedcafa6b31456))
* **prompt:** add exception for destructive ops that require user confirmation ([7f9a423](https://github.com/patrick-mns/micelio-code/commit/7f9a423380af96be33c84e44198332085bdd9bd1))
* remove Documents entitlement, add .taurignore for Vite temp files ([dbd7e7a](https://github.com/patrick-mns/micelio-code/commit/dbd7e7a875fe07e862103f2a9fc260c6c665cf2e))
* **scan:** don't freeze on minified files; make cancel responsive ([5e152db](https://github.com/patrick-mns/micelio-code/commit/5e152db7b07dbab3dc2a0a4bbbcce642defb4ab5))
* **sidebar:** add gap between session items ([f0d74c3](https://github.com/patrick-mns/micelio-code/commit/f0d74c383a9e5cb9f9889a4dabd3c1f3c4a83604))
* **sidebar:** add padding between session list and footer ([8747452](https://github.com/patrick-mns/micelio-code/commit/874745249fb76534515fa1a0053a62490385354a))
* **stream:** format elapsed time and live token count in status bar ([4e73d82](https://github.com/patrick-mns/micelio-code/commit/4e73d82733927ac1bee31839ff959ad3e4ab6669))
* **workspace:** don't block workspace creation on a synchronous scan ([ed1a2a1](https://github.com/patrick-mns/micelio-code/commit/ed1a2a117bf1d8adde7721519d07f917f9d34c3a))
* **workspace:** don't scan on startup — the window never opened ([079bfd9](https://github.com/patrick-mns/micelio-code/commit/079bfd94dc6148b15fdb27a046cbe0a755038342))
* **workspace:** restore workspace list with switch action ([5719073](https://github.com/patrick-mns/micelio-code/commit/5719073545551eb7826f3ba19dbeaa4df15b8aa5))
* **workspace:** single source of truth for the settings workspace list ([4b6686f](https://github.com/patrick-mns/micelio-code/commit/4b6686fc0be5f7431920390b8d58cecffb95c726))
* **workspace:** sync currentSession when switching/deleting workspace ([b828e3e](https://github.com/patrick-mns/micelio-code/commit/b828e3ecbb7fb1ff7fc9c66a9c97dd5caa2afcca))
* **workspace:** three bugs preventing workspace switch + treemap load ([dc86d7b](https://github.com/patrick-mns/micelio-code/commit/dc86d7bcabe8f87e264cbd5bc20eb0af3d7cd383))
* **workspace:** use ipc.pickFolder instead of broken dynamic dialog import ([c3d5c26](https://github.com/patrick-mns/micelio-code/commit/c3d5c269734269da41a4bc6de6d1743b439310fb))

## [0.3.7](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.6...micelio-v0.3.7) (2026-07-01)


### Bug Fixes

* **macos:** single Documents permission prompt (TCC) instead of multiple ([a25c542](https://github.com/patrick-mns/micelio-code/commit/a25c54239f96b5658daaedf4d9c4eba8364d3f7d))

## [0.3.6](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.5...micelio-v0.3.6) (2026-06-30)


### Bug Fixes

* **updater:** remove unnecessary borrow flagged by clippy ([1b8a107](https://github.com/patrick-mns/micelio-code/commit/1b8a10744bc733d931468a4679e7b782456777ff))

## [0.3.5](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.4...micelio-v0.3.5) (2026-06-30)


### Bug Fixes

* **windows:** improve error feedback when commands fail without output ([3d07945](https://github.com/patrick-mns/micelio-code/commit/3d0794543659696b7ade5bad8cff33f073f3f0a4))

## [0.3.4](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.3...micelio-v0.3.4) (2026-06-30)


### Bug Fixes

* **windows:** use platform-appropriate commands in terminal tool and openers ([07c8098](https://github.com/patrick-mns/micelio-code/commit/07c8098001f2c451b61eaedd2844fdd3448b4a4f))

## [0.3.3](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.2...micelio-v0.3.3) (2026-06-29)


### Bug Fixes

* **windows:** suppress console windows spawned by LLM terminal tool ([20c5248](https://github.com/patrick-mns/micelio-code/commit/20c5248e6e47a9b46f9b5b08cf9d18d787527d1d))

## [0.3.2](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.1...micelio-v0.3.2) (2026-06-29)


### Bug Fixes

* **windows:** import CommandExt trait for creation_flags method ([8be1e11](https://github.com/patrick-mns/micelio-code/commit/8be1e117edd7a0ef07f5e9ca68e6d7ef60e652cf))

## [0.3.1](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.3.0...micelio-v0.3.1) (2026-06-29)


### Bug Fixes

* **windows:** hide console windows spawned by git child processes ([e929069](https://github.com/patrick-mns/micelio-code/commit/e929069ec979220a9b0f9ce2b1115a3b3b2225c4))

## [0.3.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.2.1...micelio-v0.3.0) (2026-06-29)


### Features

* add cancel button and Escape key to workspace indexing overlay ([8d26ad6](https://github.com/patrick-mns/micelio-code/commit/8d26ad62720fdc4674e55d446b88f452324bfabd))

## [0.2.1](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.2.0...micelio-v0.2.1) (2026-06-29)


### Bug Fixes

* updater stuck in Checking — race condition on status return ([a49accb](https://github.com/patrick-mns/micelio-code/commit/a49accb18da46b48e482b33c370f582af291166d))

## [0.2.0](https://github.com/patrick-mns/micelio-code/compare/micelio-v0.1.0...micelio-v0.2.0) (2026-06-29)


### Features

* initial release v0.1.0 ([f165e12](https://github.com/patrick-mns/micelio-code/commit/f165e12814b0a08a3400a56ebd70cec01ea79c6a))
