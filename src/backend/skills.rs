//! Skills — carregamento e parsing de `.micelio/skills/<nome>/SKILL.md`.
//!
//! Segue o padrão Claude Code: cada skill é uma subpasta com um `SKILL.md`
//! contendo frontmatter YAML + corpo markdown. O registry cacheia skills
//! descobertas no workspace e fornece os dados para o frontend e para
//! injeção no system prompt.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

// ── Tipos ──────────────────────────────────────────────────────────────────

/// Metadados extraídos do frontmatter YAML de um `SKILL.md`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMeta {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_display_name", alias = "display-name")]
    pub display_name: String,
    #[serde(default)]
    pub license: String,
    #[serde(default, alias = "default-enabled")]
    pub default_enabled: bool,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

fn default_display_name() -> String {
    String::new()
}

/// Skill completa: metadados + corpo (markdown) + caminho no disco.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub meta: SkillMeta,
    /// Corpo do SKILL.md (o que vai ser injetado no system prompt).
    pub body: String,
    /// Caminho absoluto da pasta da skill.
    pub path: String,
    /// Se a skill está ativa (habilita/desabilita via UI).
    #[serde(default)]
    pub enabled: bool,
}

/// Resumo leve para listar no frontend sem carregar o body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSummary {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub enabled: bool,
    /// Caminho absoluto do arquivo de ícone (svg, png, webp), se existir.
    #[serde(default)]
    pub icon_path: Option<String>,
}

// ── Registry ───────────────────────────────────────────────────────────────

static SKILL_REGISTRY: OnceLock<Mutex<SkillRegistry>> = OnceLock::new();

fn skill_registry() -> &'static Mutex<SkillRegistry> {
    SKILL_REGISTRY.get_or_init(|| Mutex::new(SkillRegistry::new()))
}

pub struct SkillRegistry {
    /// Skills carregadas, indexadas por nome.
    skills: HashMap<String, Skill>,
    /// Workspace root onde foram carregadas (pra invalidar no reload).
    workspace_root: Option<PathBuf>,
}

impl SkillRegistry {
    fn new() -> Self {
        Self {
            skills: HashMap::new(),
            workspace_root: None,
        }
    }

    /// Carrega (ou recarrega) skills do diretório `.micelio/skills/` dentro de
    /// `workspace_root`. Skills que já existiam mantêm seu estado `enabled`.
    pub fn load(workspace_root: &Path) {
        let mut reg = skill_registry().lock().unwrap();
        let skills_dir = workspace_root.join(".micelio").join("skills");

        let mut new_skills: HashMap<String, Skill> = HashMap::new();

        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let skill_path = entry.path();
                if !skill_path.is_dir() {
                    continue;
                }
                let skill_file = skill_path.join("SKILL.md");
                if !skill_file.exists() {
                    continue;
                }
                match parse_skill_file(&skill_file) {
                    Ok(skill) => {
                        let name = skill.meta.name.clone();
                        // Preserva estado enabled se já existia
                        let enabled = reg
                            .skills
                            .get(&name)
                            .map(|s| s.enabled)
                            .unwrap_or(skill.meta.default_enabled);
                        let mut skill = skill;
                        skill.enabled = enabled;
                        new_skills.insert(name, skill);
                    }
                    Err(e) => {
                        eprintln!("[skills] skiplling {skill_path:?}: {e}");
                    }
                }
            }
        }

        reg.skills = new_skills;
        reg.workspace_root = Some(workspace_root.to_path_buf());
    }

    /// Retorna a lista de skills ativas (enabled).
    pub fn active_skills() -> Vec<Skill> {
        let reg = skill_registry().lock().unwrap();
        reg.skills
            .values()
            .filter(|s| s.enabled)
            .cloned()
            .collect()
    }

    /// Retorna summaries de todas as skills carregadas.
    pub fn list_skills() -> Vec<SkillSummary> {
        let reg = skill_registry().lock().unwrap();
        reg.skills
            .values()
            .map(|s| {
                let icon = skill_icon_path(Path::new(&s.path));
                SkillSummary {
                    name: s.meta.name.clone(),
                    display_name: if s.meta.display_name.is_empty() {
                        s.meta.name.clone()
                    } else {
                        s.meta.display_name.clone()
                    },
                    description: s.meta.description.clone(),
                    enabled: s.enabled,
                    icon_path: icon,
                }
            })
            .collect()
    }

    /// Retorna a skill completa (meta + body) pelo nome.
    pub fn get_skill(name: &str) -> Option<Skill> {
        let reg = skill_registry().lock().unwrap();
        reg.skills.get(name).cloned()
    }

    /// Define o estado enabled de uma skill. Retorna `false` se não existe.
    pub fn set_skill_enabled(name: &str, enabled: bool) -> bool {
        let mut reg = skill_registry().lock().unwrap();
        if let Some(skill) = reg.skills.get_mut(name) {
            skill.enabled = enabled;
            true
        } else {
            false
        }
    }

    /// Alterna o estado enabled de uma skill.
    pub fn toggle_skill(name: &str) -> bool {
        let mut reg = skill_registry().lock().unwrap();
        if let Some(skill) = reg.skills.get_mut(name) {
            skill.enabled = !skill.enabled;
            skill.enabled
        } else {
            false
        }
    }

    /// Retorna o corpo do system prompt adicional com skills ativas.
    pub fn skills_prompt_section() -> String {
        let active = Self::active_skills();
        if active.is_empty() {
            return String::new();
        }
        let mut section = String::from("\n\n── Active Skills ──\n\n");
        for skill in &active {
            section.push_str(&skill.body);
            section.push_str("\n\n");
        }
        section
    }
}

// ── Parser de SKILL.md ────────────────────────────────────────────────────

/// Dado o caminho de um `SKILL.md`, retorna a skill parseada.
fn parse_skill_file(path: &Path) -> Result<Skill, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;

    let (meta, body) = parse_frontmatter(&raw)?;

    Ok(Skill {
        meta,
        body,
        path: path.parent().unwrap_or(path).to_string_lossy().to_string(),
        enabled: false,
    })
}

/// Separa frontmatter YAML (delimitado por `---`) do corpo markdown.
/// Retorna (meta, body).
fn parse_frontmatter(raw: &str) -> Result<(SkillMeta, String), String> {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return Err("SKILL.md must start with `---` frontmatter".into());
    }

    // Pula a primeira linha "---"
    let after_opener = &trimmed[3..];
    let end = after_opener
        .find("\n---")
        .ok_or_else(|| "missing closing `---` in SKILL.md frontmatter".to_string())?;

    let yaml_str = &after_opener[..end];
    let body_start = after_opener[end + 4..].trim_start().to_string();

    let meta: SkillMeta =
        serde_yaml::from_str(yaml_str).map_err(|e| format!("invalid YAML frontmatter: {e}"))?;

    Ok((meta, body_start))
}

/// Procura um arquivo de ícone (svg, png, webp) na pasta da skill
/// e retorna o caminho absoluto, se existir.
fn skill_icon_path(skill_path: &Path) -> Option<String> {
    for ext in &["svg", "png", "webp"] {
        let p = skill_path.join(format!("icon.{ext}"));
        if p.exists() {
            // resolve para caminho absoluto canonico
            return p.canonicalize().ok().map(|a| a.to_string_lossy().to_string());
        }
    }
    None
}

// ── Testes ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_skill() {
        let raw = r#"---
name: test-skill
description: A test
---

# Hello

This is the body."#;
        let (meta, body) = parse_frontmatter(raw).unwrap();
        assert_eq!(meta.name, "test-skill");
        assert_eq!(meta.description, "A test");
        assert!(meta.license.is_empty());
        assert!(body.contains("Hello"));
    }

    #[test]
    fn parse_full_skill() {
        let raw = r#"---
name: code-reviewer
description: Expert code review
display-name: Code Reviewer
license: MIT
default-enabled: true
metadata:
  category: development
  effort: high
---

# Code Review

Check for security issues."#;
        let (meta, body) = parse_frontmatter(raw).unwrap();
        assert_eq!(meta.name, "code-reviewer");
        assert_eq!(meta.display_name, "Code Reviewer");
        assert_eq!(meta.license, "MIT");
        assert!(meta.default_enabled);
        assert_eq!(meta.metadata.get("category").unwrap(), "development");
        assert!(body.contains("security"));
    }

    #[test]
    fn parse_missing_frontmatter() {
        let raw = "Just a regular markdown file.";
        let result = parse_frontmatter(raw);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must start with `---`"));
    }

    #[test]
    fn load_skills_from_directory() {
        let dir = std::env::temp_dir().join("micelio-test-skills");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".micelio").join("skills").join("my-skill")).unwrap();

        let skill_content = r#"---
name: my-skill
description: A test skill
---

# My Skill

Hello world!"#;
        std::fs::write(
            dir.join(".micelio")
                .join("skills")
                .join("my-skill")
                .join("SKILL.md"),
            skill_content,
        )
        .unwrap();

        SkillRegistry::load(&dir);
        let skills = SkillRegistry::list_skills();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");

        // toggle
        let enabled = SkillRegistry::toggle_skill("my-skill");
        assert!(enabled);

        let active = SkillRegistry::active_skills();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].meta.name, "my-skill");

        let _ = std::fs::remove_dir_all(&dir);
    }
}