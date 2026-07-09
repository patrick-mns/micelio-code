# Changelog

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
