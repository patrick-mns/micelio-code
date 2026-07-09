# Prompt & Reflection System — Architecture

```mermaid
flowchart TB
    subgraph backend["src/backend/prompt.rs"]
        direction TB
        SP[system_prompt] -->|custom override?| DPS[default_system_prompt]
        DPS -->|injecta OS + arch + locale| OS_LINE["Host environment: OS=macOS (aarch64), locale=en_BR"]
        DPS -->|instruções de ferramentas| TOOL_INST["terminal, search, file, edit, vision, fetch"]
        DPS -->|Windows hints| WIN_HINTS["cmd.exe /C, findstr, taskkill..."]

        REFLEXION_MSG["REFLEXION<br/>'STOP and reflect before retrying'"]
        NEEDS_TOOL_MSG["NEEDS_TOOL<br/>'You must respond with a tool call'"]
        TOOL_FAIL["TOOL_FAILURE_STOP<br/>'Failed repeatedly. STOP and explain'"]
        SUMMARY_REQ["SUMMARY_REQUEST<br/>'Write concise summary of work'"]
    end

    subgraph agent["src/commands/agent.rs"]
        direction TB
        LOOP[run_agent_loop] --> LLM_CALL["1. Chama LLM (streaming)<br/>emite eventos pro frontend"]
        LLM_CALL --> DECIDE{"2. Resposta tem tool_call?"}

        DECIDE -->|SIM| STAGNATION{"Stagnation Guard<br/>3x mesma tool + args?"}
        STAGNATION -->|sim, stuck| FORCE_STOP["force_stop_summary<br/>+ finish()"]
        STAGNATION -->|não| EXECUTE["Executa ferramenta(s)"]
        EXECUTE --> ERROR_CHECK{"Teve erro?"}

        ERROR_CHECK -->|sim| CONSEC_ERRORS["consecutive_errors += 1"]
        CONSEC_ERRORS --> REFLECTION{"≥2 erros?"}
        REFLECTION -->|não| REFEED["Volta resultado pro history<br/>→ LLM_CALL"]
        REFLECTION -->|sim, ≥2| REFLEXION_INJECT["Injeta prompt::REFLEXION<br/>'STOP and reflect'"]
        REFLEXION_INJECT --> REFEED

        CONSEC_ERRORS --> HARD_STOP{"≥3 erros?"}
        HARD_STOP -->|sim| TOOL_FAIL_INJECT["Injeta TOOL_FAILURE_STOP<br/>+ force_stop_summary"]
        TOOL_FAIL_INJECT --> FIM["finish()<br/>encerra o turno"]

        ERROR_CHECK -->|não| RESET_ERRORS["consecutive_errors = 0"]
        RESET_ERRORS --> REFEED

        DECIDE -->|NÃO| CONTENT_CHECK{"content vazio<br/>+ needs_tool?"}
        CONTENT_CHECK -->|sim, 1ª vez| NEEDS_TOOL_INJECT["Injeta prompt::NEEDS_TOOL<br/>volta pro LLM"]
        CONTENT_CHECK -->|não| MODEL_DONE["Modelo respondeu sem tool<br/>→ finish()"]
        MODEL_DONE --> AUTO_SUMMARY["Auto-summary dos<br/>arquivos dirty"]
    end

    subgraph compaction["Context Compaction (dentro do loop)"]
        COMPACT[compact_history] --> CHECK_BUDGET{"Total tokens > 24k?"}
        CHECK_BUDGET -->|não| SKIP["mantém intacto"]
        CHECK_BUDGET -->|sim| ELIDE["Elide conteúdo de<br/>tool results antigos"]
        ELIDE --> KEEP["Mantém 6 mais recentes<br/>intactos (KEEP_RECENT_TOOL_RESULTS)"]
        ELIDE --> PRESERVE["Preserva estrutura<br/>das mensagens (role pairing)"]

        TRUNCATE[truncate_tool_result] --> CHECK_SIZE{"Resultado > 8k chars?"}
        CHECK_SIZE -->|não| AS_IS["passa intacto"]
        CHECK_SIZE -->|sim| CUT["corta head + tail<br/>com marcador [... elided ...]"]
    end

    subgraph chat_commands["src/commands/chat.rs"]
        SEND[send_message] --> LOOP
        GET[get_system_prompt] --> SP
        SET[set_system_prompt] -->|salva override| CONFIG[config::save_system_prompt_override]
        RESET[reset_system_prompt] -->|limpa override| CONFIG_CLEAR[config::clear_system_prompt_override]
        COMPACT_CHAT[compact_chat_blocking] -->|sumariza msgs antigas via LLM| HISTORY_SHRINK["encolhe histórico"]
    end

    subgraph constants["Limites (agent.rs)"]
        MAX_ROUNDS["MAX_TOOL_ROUNDS = 50"]
        MAX_ERRORS["MAX_CONSECUTIVE_ERRORS = 3"]
        REFLEXION_AFTER["REFLEXION_AFTER_ERRORS = 2"]
        MAX_IDENT["MAX_IDENTICAL_CALLS = 3"]
        TOOL_RESULT_MAX["TOOL_RESULT_MAX_CHARS = 8_000"]
        CTX_BUDGET["CONTEXT_TOKEN_BUDGET = 24_000"]
        KEEP_RECENT["KEEP_RECENT_TOOL_RESULTS = 6"]
    end

    %% Connections
    LOOP -.-> COMPACT
    LOOP -.-> TRUNCATE
    SP -.->|incluído no history| LOOP
```

## Fluxo resumido

1. **`chat.rs`** recebe o comando do usuário (`send_message`) e chama `run_agent_loop()`
2. **`run_agent_loop()`** monta o history com o system prompt (`prompt::system_prompt()`) + mensagens anteriores + mensagem do usuário
3. Loop principal:
   - Chama o LLM (streaming), emite eventos pro frontend
   - Se o modelo **chamou ferramenta(s)**:
     - Stagnation guard: se 3x mesma chamada → para
     - Executa as ferramentas, trunca resultados > 8k chars
     - Se deu erro: reflection após 2 erros, hard stop após 3
     - Volta pro LLM com o resultado das tools
   - Se o modelo **não chamou ferramenta**: finish() + auto-summary
4. **Context compaction** acontece entre rounds quando o histórico estimado > 24k tokens
5. O usuário pode customizar o system prompt via `set_system_prompt()` (que persiste um override no config)