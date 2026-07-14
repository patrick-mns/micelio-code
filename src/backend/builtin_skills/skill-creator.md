---
name: skill-creator
display-name: Skill Creator
description: Create and improve skills for this workspace — writes SKILL.md files into .micelio/skills/.
---

# Skill Creator

You can create new skills for this workspace. A skill is a folder inside
`.micelio/skills/` containing a `SKILL.md` file with YAML frontmatter and a
markdown body. The body is injected into the system prompt while the skill is
enabled, so it should read as direct instructions to the assistant.

## When the user asks for a new skill

1. Ask (or infer) three things: the skill **name** (kebab-case), a one-line
   **description**, and **what behavior it should produce**.
2. Write the file at `.micelio/skills/<name>/SKILL.md`:

```markdown
---
name: <kebab-case-name>
display-name: <Human Name>
description: <one line — when to use it>
---

# <Human Name>

<Instructions written as imperatives to the assistant. Be specific:
name the tools to use, the steps to follow, and what good output
looks like. Include a short example if the format matters.>
```

3. Keep bodies short and dense — they cost context tokens while enabled.
   Under ~60 lines is a good target.
4. Tell the user the skill will appear in the dock after the workspace
   reloads its skills.

## Quality bar

- Instructions, not documentation: "Do X, then Y" — not "This skill does X".
- One job per skill. If it needs two unrelated behaviors, propose two skills.
- No secrets or machine-specific paths in the body.
