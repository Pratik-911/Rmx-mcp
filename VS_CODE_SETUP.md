# VS Code MCP Configuration for Rezoomex

## Setup Instructions

1. **Install MCP Extension**
   - Install the official MCP extension for VS Code
   - Restart VS Code after installation

2. **Configure MCP Server**
   - Copy the contents of `vscode-mcp.json` 
   - Add to your workspace `.vscode/mcp.json` file (recommended) or global config
   - Global config locations:
     - **Windows**: `%APPDATA%\Code\User\mcp.json`
     - **macOS**: `~/Library/Application Support/Code/User/mcp.json`
     - **Linux**: `~/.config/Code/User/mcp.json`

## Configuration File

**For workspace-specific (recommended):** `.vscode/mcp.json`
```json
{
  "servers": {
    "rezoomex": {
      "command": "node",
      "args": ["mcp-server.js"],
      "cwd": "/Users/pratik/Documents/Projects/Rezoomex/image-processing/rezoomex"
    }
  }
}
```

## Available MCP Tools

Once configured, you'll have access to these Rezoomex tools:

- **`authenticate`** - Login with your Rezoomex credentials
- **`list_projects`** - Show your accessible projects
- **`get_project_by_name`** - Find project by name
- **`get_user_stories_by_name`** - Get stories using project/persona names
- **`list_user_stories`** - List stories by project/persona IDs
- **`get_single_story_details`** - Get individual story details
- **`get_user_info`** - Your user profile information
- **`check_nda_status`** - Your NDA signing status
- **`get_project_overview`** - Project elevator pitch and vision
- **`get_project_environment`** - Project personas and environment
- **`get_persona_profile`** - Detailed persona information
- **`get_user_journey`** - User journey events and touchpoints
- **`get_jobs_to_be_done`** - JTBD analysis for personas

## Usage

1. **Authentication Required**
   - Use the `authenticate` tool first with your Rezoomex email and password
   - Example: Call `authenticate` tool with `{"email": "your@email.com", "password": "yourpassword"}`
   - This establishes your session for other tools

2. **Project Access**
   - Use `list_projects` to see your accessible projects
   - Use project names or IDs with other tools

3. **Session Management**
   - Authentication persists during your VS Code session
   - Re-authenticate if you get "Not authenticated" errors

## Security Features

- ✅ **User Isolation** - Each user sees only their accessible projects
- ✅ **Secure Authentication** - No credentials stored in config file
- ✅ **Session Management** - Proper session handling per user
- ✅ **Dynamic Discovery** - Projects discovered based on actual permissions

## Troubleshooting

**No projects showing?**
- Ensure you have access to Rezoomex projects
- Contact admin to verify your project permissions

**Authentication issues?**
- Check your email and password are correct
- Ensure you have a valid Rezoomex account

**Connection problems?**
- Verify internet connection
- Check if https://rmx-mcp.onrender.com is accessible
