# Rezoomex MCP Server (Node.js)

A Node.js-based Server-Sent Events (SSE) MCP server for Rezoomex API integration with bearer token authentication.

## Features

- **SSE Support**: Real-time streaming responses for long-running operations
- **Bearer Token Authentication**: Secure authentication using Rezoomex bearer tokens
- **Comprehensive API Coverage**: All major Rezoomex API endpoints
- **Session Management**: Multi-user session handling with automatic cleanup
- **Proper Error Handling**: Detailed error messages and logging
- **Rate Limiting**: Built-in protection against abuse
- **Health Monitoring**: Health check endpoints and logging

## Quick Start

### 1. Installation

```bash
cd /Users/pratik/Documents/Projects/Rezoomex/image-processing/rezoomex
npm install
```

### 2. Configuration

Copy the environment template:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
PORT=3000
NODE_ENV=development
REZOOMEX_BASE_URL=https://awsapi-gateway.rezoomex.com
# No default projects - all project_id and persona_id must be provided
```

### 3. Start the Server

```bash
npm start
```

The server will be available at `http://localhost:3000`

## Authentication Flow

### Step 1: Get Login URL
```bash
curl http://localhost:3000/auth/login-url
```

Response:
```json
{
  "loginUrl": "https://workspace.rezoomex.com/account/login",
  "instructions": "Please login at the provided URL and extract the bearer token from the URL after successful authentication.",
  "tokenLocation": "The bearer token will be in the URL as access_token parameter after login."
}
```

### Step 2: Login and Extract Bearer Token

1. Visit the login URL in your browser
2. Login with your Rezoomex credentials
3. After successful login, extract the `access_token` from the URL
4. The URL will look like: `https://workspace.rezoomex.com/dashboard?access_token=YOUR_BEARER_TOKEN&...`

### Step 3: Authenticate with Server

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: your-session-id" \
  -d '{"bearerToken": "YOUR_BEARER_TOKEN"}'
```

Response:
```json
{
  "success": true,
  "sessionId": "your-session-id",
  "message": "Authentication successful. Use this session ID for subsequent requests.",
  "expiresIn": "24 hours"
}
```

## API Endpoints

### Health Check
```bash
GET /health
```

### Authentication
```bash
GET /auth/login-url                    # Get login URL
POST /auth/token                       # Authenticate with bearer token
GET /auth/session/:sessionId           # Check session status
DELETE /auth/session/:sessionId        # Clear session
```

### MCP Tools
```bash
GET /mcp/tools                         # List available tools
GET /mcp/execute/:toolName             # Execute tool via SSE
POST /mcp/execute/:toolName            # Execute tool via POST
```

## Available MCP Tools

| Tool Name | Description | Required Parameters |
|-----------|-------------|--------------------|
| `list_user_stories` | List all user stories with numbers for a project and persona | `project_id`, `persona_id` |
| `get_story_range` | Get user stories in a range (e.g., stories 1-5) with all details | `project_id`, `persona_id`, `start_number`, `end_number` |
| `get_single_story_details` | Get detailed information for a single user story | `project_id`, `persona_id` |
| `get_project_overview` | Get comprehensive project overview | `project_id` |
| `get_persona_profile` | Get detailed persona profile | `project_id`, `persona_id` |
| `get_user_journey` | Get detailed user journey events | `project_id`, `persona_id` |
| `get_jobs_to_be_done` | Get Jobs to be Done analysis | `project_id`, `persona_id` |
| `get_user_info` | Get authenticated user profile information | None |
| `get_project_environment` | Get project environment information including personas | `project_id` |
| `check_nda_status` | Check NDA status for the authenticated user | None |
| `get_product_info` | Get detailed product information for a project | `project_id` |

### Name-Based Lookup Tools (User-Friendly)

| Tool Name | Description | Required Parameters |
|-----------|-------------|--------------------|
| `list_projects` | List all available projects with their names and IDs | None |
| `find_project_by_name` | Find a project by its name and get the project ID | `project_name` |
| `find_persona_by_name` | Find a persona by name within a project and get the persona ID | `project_id`, `persona_name` |
| `get_user_stories_by_name` | List user stories using project and persona names (more user-friendly) | `project_name`, `persona_name` |
| `get_persona_by_name` | Get persona profile using project and persona names (more user-friendly) | `project_name`, `persona_name` |

### Legacy Tools (Backward Compatibility)

| Tool Name | Description | Required Parameters |
|-----------|-------------|--------------------|
| `mcp0_getUserInfo` | Legacy: Get authenticated user profile information | None |
| `mcp0_fetchPersona` | Legacy: Get persona details by project and persona ID | `projectId`, `personaId` |
| `mcp0_fetchElevatorPitch` | Legacy: Get project elevator pitch | `projectId` |
| `mcp0_fetchVisionStatement` | Legacy: Get project vision statement | `projectId` |
| `mcp0_fetchProductInfo` | Legacy: Get product information | `projectId` |
| `mcp0_fetchProjectEnvironment` | Legacy: Get project environment information | `projectId` |
| `mcp0_checkNdaStatus` | Legacy: Check NDA status for the authenticated user | None |

## Usage Examples

### Using SSE (Server-Sent Events)

```javascript
const eventSource = new EventSource(
  'http://localhost:3000/mcp/execute/list_user_stories?project_id=39SQ&persona_id=39SQ-P-003',
  {
    headers: {
      'X-Session-ID': 'your-session-id'
    }
  }
);

eventSource.addEventListener('progress', (event) => {
  const data = JSON.parse(event.data);
  console.log('Progress:', data.message);
});

eventSource.addEventListener('result', (event) => {
  const data = JSON.parse(event.data);
  console.log('Result:', data.result);
});

eventSource.addEventListener('complete', (event) => {
  console.log('Operation completed');
  eventSource.close();
});

eventSource.addEventListener('error', (event) => {
  const data = JSON.parse(event.data);
  console.error('Error:', data.message);
});
```

### Using POST Requests

```bash
# Using IDs (traditional way)
curl -X POST http://localhost:3000/mcp/execute/list_user_stories \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: your-session-id" \
  -d '{"project_id": "39SQ", "persona_id": "39SQ-P-003"}'

# Using names (user-friendly way)
curl -X POST http://localhost:3000/mcp/execute/get_user_stories_by_name \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: your-session-id" \
  -d '{"project_name": "Talentally Yours", "persona_name": "Priya Sinha"}'
```

### Get Story Range

```bash
curl -X POST http://localhost:3000/mcp/execute/get_story_range \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: your-session-id" \
  -d '{"start_number": 1, "end_number": 5, "project_id": "39SQ", "persona_id": "39SQ-P-003"}'
```

### Get Single Story Details

```bash
curl -X POST http://localhost:3000/mcp/execute/get_single_story_details \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: your-session-id" \
  -d '{"story_number": 1, "project_id": "39SQ", "persona_id": "39SQ-P-003"}'
```

## Error Handling

The server provides detailed error messages for different scenarios:

- **Authentication Required**: `AUTH_REQUIRED` - Need to authenticate first
- **Session Expired**: `SESSION_EXPIRED` - Need to re-authenticate
- **Unknown Tool**: `UNKNOWN_TOOL` - Tool name not recognized
- **Validation Error**: `VALIDATION_ERROR` - Invalid input parameters
- **Execution Error**: `EXECUTION_ERROR` - Error during tool execution

## Logging

Logs are written to both console and file (`logs/rezoomex-mcp.log`). Log levels:

- `error`: Critical errors
- `warn`: Warning messages
- `info`: General information
- `debug`: Detailed debugging information

## Development

### Run in Development Mode
```bash
npm run dev
```

### Run Tests
```bash
npm test
```

## Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `REZOOMEX_BASE_URL` | `https://awsapi-gateway.rezoomex.com` | Rezoomex API base URL |
| `REZOOMEX_LOGIN_URL` | `https://workspace.rezoomex.com/account/login` | Login URL |
| `DEFAULT_PROJECT_ID` | `39SQ` | Default project ID |
| `DEFAULT_PERSONA_ID` | `39SQ-P-003` | Default persona ID |
| `LOG_LEVEL` | `info` | Logging level |
| `LOG_FILE` | `logs/rezoomex-mcp.log` | Log file path |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |
| `CORS_ORIGIN` | `*` | CORS origin setting |

## Security Features

- **Helmet.js**: Security headers
- **Rate Limiting**: Prevents abuse
- **CORS**: Configurable cross-origin requests
- **Session Timeout**: Automatic session cleanup
- **Input Validation**: Parameter validation for all tools
- **Error Sanitization**: Safe error messages

## Architecture

```
rezoomex/
├── server.js              # Main server file
├── lib/
│   ├── rezoomex-client.js  # Rezoomex API client
│   ├── auth-manager.js     # Authentication management
│   └── mcp-tools.js        # MCP tool definitions
├── logs/                   # Log files
├── package.json
├── .env.example
└── README.md
```

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Ensure bearer token is valid and not expired
   - Check that you're using the correct login URL
   - Verify the token was extracted correctly from the URL

2. **Session Expired**
   - Re-authenticate using `/auth/token` endpoint
   - Check session timeout settings

3. **API Errors**
   - Verify project ID and persona ID are correct
   - Check Rezoomex API status
   - Review server logs for detailed error information

4. **Connection Issues**
   - Ensure server is running on correct port
   - Check firewall settings
   - Verify network connectivity to Rezoomex API

### Debug Mode

Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions, please check the logs first and ensure your authentication is valid. The server provides detailed error messages to help diagnose problems.
