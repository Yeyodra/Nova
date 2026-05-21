use serde_json::{Map, Value};

use crate::mcp::types::McpTool;
use crate::tools::executor::ToolName;

/// Identifies where a tool call should be routed
pub enum ToolSource {
    Builtin(ToolName),
    Mcp { server_id: String, tool_name: String },
}

/// Dynamic registry that merges built-in tools with MCP tools.
/// Created fresh before each agent run to reflect current MCP state.
pub struct ToolRegistry {
    /// (server_id, server_name, tool)
    mcp_tools: Vec<(String, String, McpTool)>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            mcp_tools: Vec::new(),
        }
    }

    /// Set MCP tools (called before each agent run to refresh)
    pub fn set_mcp_tools(&mut self, tools: Vec<(String, String, McpTool)>) {
        self.mcp_tools = tools;
    }

    /// Get all tool definitions in OpenAI format (builtin + MCP)
    pub fn get_all_tools_openai(&self, builtin_defs: Vec<Value>) -> Vec<Value> {
        let mut all = builtin_defs;
        for (_server_id, server_name, tool) in &self.mcp_tools {
            let prefixed_name = format!("{}__{}", sanitize_name(server_name), tool.name);
            let mut function_map = Map::new();
            function_map.insert("name".into(), Value::String(prefixed_name));
            function_map.insert("description".into(), Value::String(tool.description.clone()));
            function_map.insert("parameters".into(), tool.input_schema.clone());

            let mut def = Map::new();
            def.insert("type".into(), Value::String("function".into()));
            def.insert("function".into(), Value::Object(function_map));
            all.push(Value::Object(def));
        }
        all
    }

    /// Get all tool definitions in Anthropic format (builtin + MCP)
    pub fn get_all_tools_anthropic(&self, builtin_defs: Vec<Value>) -> Vec<Value> {
        let mut all = builtin_defs;
        for (_server_id, server_name, tool) in &self.mcp_tools {
            let prefixed_name = format!("{}__{}", sanitize_name(server_name), tool.name);
            let mut def = Map::new();
            def.insert("name".into(), Value::String(prefixed_name));
            def.insert("description".into(), Value::String(tool.description.clone()));
            def.insert("input_schema".into(), tool.input_schema.clone());
            all.push(Value::Object(def));
        }
        all
    }

    /// Resolve a tool call name to its source
    pub fn resolve_tool_call(&self, name: &str) -> ToolSource {
        // Check if it's an MCP tool (contains "__" separator)
        if let Some(sep_pos) = name.find("__") {
            let server_name_part = &name[..sep_pos];
            let tool_name = &name[sep_pos + 2..];
            // Find matching server by sanitized name
            for (sid, sname, _) in &self.mcp_tools {
                if sanitize_name(sname) == server_name_part {
                    return ToolSource::Mcp {
                        server_id: sid.clone(),
                        tool_name: tool_name.to_string(),
                    };
                }
            }
        }
        // Fall back to builtin tool resolution
        ToolSource::Builtin(map_tool_name_to_enum(name))
    }

    /// Check if registry has any MCP tools loaded
    pub fn has_mcp_tools(&self) -> bool {
        !self.mcp_tools.is_empty()
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Sanitize server name for use as tool name prefix.
/// Replaces non-alphanumeric chars with underscores, collapses runs.
fn sanitize_name(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut last_was_underscore = false;

    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
            last_was_underscore = false;
        } else if !last_was_underscore {
            result.push('_');
            last_was_underscore = true;
        }
    }

    // Trim trailing underscore
    if result.ends_with('_') {
        result.pop();
    }

    result
}

fn map_tool_name_to_enum(name: &str) -> ToolName {
    match name {
        "read_file" => ToolName::ReadFile,
        "write_file" => ToolName::WriteFile,
        "patch_file" => ToolName::PatchFile,
        "list_dir" => ToolName::ListDir,
        "search_files" => ToolName::SearchFiles,
        "run_command" => ToolName::RunCommand,
        "web_search" => ToolName::WebSearch,
        // Fallback — will error at execution time
        _ => ToolName::ReadFile,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("My Server"), "my_server");
        assert_eq!(sanitize_name("file-system"), "file_system");
        assert_eq!(sanitize_name("MCP  Server!!"), "mcp_server");
    }

    #[test]
    fn test_resolve_builtin() {
        let registry = ToolRegistry::new();
        match registry.resolve_tool_call("read_file") {
            ToolSource::Builtin(ToolName::ReadFile) => {}
            _ => panic!("Expected Builtin(ReadFile)"),
        }
    }

    #[test]
    fn test_resolve_mcp_tool() {
        let mut registry = ToolRegistry::new();
        registry.set_mcp_tools(vec![(
            "server-123".to_string(),
            "filesystem".to_string(),
            McpTool {
                name: "read".to_string(),
                description: "Read a file".to_string(),
                input_schema: json!({"type": "object"}),
            },
        )]);

        match registry.resolve_tool_call("filesystem__read") {
            ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, "server-123");
                assert_eq!(tool_name, "read");
            }
            _ => panic!("Expected Mcp source"),
        }
    }

    #[test]
    fn test_resolve_mcp_tool_with_special_chars_in_server_name() {
        let mut registry = ToolRegistry::new();
        registry.set_mcp_tools(vec![(
            "srv-456".to_string(),
            "My Cool Server!".to_string(),
            McpTool {
                name: "do_thing".to_string(),
                description: "Does a thing".to_string(),
                input_schema: json!({"type": "object"}),
            },
        )]);

        // sanitize_name("My Cool Server!") => "my_cool_server"
        match registry.resolve_tool_call("my_cool_server__do_thing") {
            ToolSource::Mcp {
                server_id,
                tool_name,
            } => {
                assert_eq!(server_id, "srv-456");
                assert_eq!(tool_name, "do_thing");
            }
            _ => panic!("Expected Mcp source"),
        }
    }

    #[test]
    fn test_get_all_tools_openai_merges_builtin_and_mcp() {
        let mut registry = ToolRegistry::new();
        registry.set_mcp_tools(vec![(
            "s1".to_string(),
            "myserver".to_string(),
            McpTool {
                name: "search".to_string(),
                description: "Search stuff".to_string(),
                input_schema: json!({"type": "object", "properties": {}}),
            },
        )]);

        let builtin_defs = vec![json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a file",
                "parameters": {"type": "object"}
            }
        })];

        let all = registry.get_all_tools_openai(builtin_defs);
        assert_eq!(all.len(), 2);
        // First is builtin
        assert_eq!(all[0]["function"]["name"], "read_file");
        // Second is MCP tool with prefixed name
        assert_eq!(all[1]["function"]["name"], "myserver__search");
        assert_eq!(all[1]["type"], "function");
    }

    #[test]
    fn test_get_all_tools_anthropic_merges_builtin_and_mcp() {
        let mut registry = ToolRegistry::new();
        registry.set_mcp_tools(vec![(
            "s1".to_string(),
            "db-server".to_string(),
            McpTool {
                name: "query".to_string(),
                description: "Run a query".to_string(),
                input_schema: json!({"type": "object"}),
            },
        )]);

        let builtin_defs = vec![json!({
            "name": "write_file",
            "description": "Write a file",
            "input_schema": {"type": "object"}
        })];

        let all = registry.get_all_tools_anthropic(builtin_defs);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["name"], "write_file");
        // sanitize_name("db-server") => "db_server"
        assert_eq!(all[1]["name"], "db_server__query");
        assert_eq!(all[1]["description"], "Run a query");
    }

    #[test]
    fn test_tool_name_prefixing_format() {
        let mut registry = ToolRegistry::new();
        registry.set_mcp_tools(vec![(
            "id-1".to_string(),
            "GitHub Copilot".to_string(),
            McpTool {
                name: "suggest".to_string(),
                description: "Suggest code".to_string(),
                input_schema: json!({}),
            },
        )]);

        let all = registry.get_all_tools_openai(vec![]);
        // sanitize_name("GitHub Copilot") => "github_copilot"
        assert_eq!(all[0]["function"]["name"], "github_copilot__suggest");
    }

    #[test]
    fn test_has_mcp_tools_empty() {
        let registry = ToolRegistry::new();
        assert!(!registry.has_mcp_tools());
    }

    #[test]
    fn test_has_mcp_tools_with_tools() {
        let mut registry = ToolRegistry::new();
        registry.set_mcp_tools(vec![(
            "s1".to_string(),
            "srv".to_string(),
            McpTool {
                name: "t".to_string(),
                description: "d".to_string(),
                input_schema: json!({}),
            },
        )]);
        assert!(registry.has_mcp_tools());
    }
}
