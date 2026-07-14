use crate::backend::skills::SkillRegistry;

#[tauri::command]
pub fn load_skills(workspace_root: String) -> Result<(), String> {
    let path = std::path::PathBuf::from(&workspace_root);
    if !path.exists() {
        return Err(format!("workspace root does not exist: {workspace_root}"));
    }
    SkillRegistry::load(&path);
    Ok(())
}

#[tauri::command]
pub fn list_skills() -> Result<Vec<crate::backend::skills::SkillSummary>, String> {
    Ok(SkillRegistry::list_skills())
}

#[tauri::command]
pub fn toggle_skill(name: String) -> Result<bool, String> {
    Ok(SkillRegistry::toggle_skill(&name))
}

#[tauri::command]
pub fn set_skill_enabled(name: String, enabled: bool) -> Result<bool, String> {
    Ok(SkillRegistry::set_skill_enabled(&name, enabled))
}

#[tauri::command]
pub fn get_skill(name: String) -> Result<crate::backend::skills::Skill, String> {
    SkillRegistry::get_skill(&name).ok_or_else(|| format!("skill not found: {name}"))
}
