# RZMX MCP Server

OAuth2-enabled Model Context Protocol (MCP) server for Rezoomex that provides seamless IDE integration with project data, user stories, personas, and project management information.

## Features

- **OAuth2 Authentication**: Seamless "connect button" experience with Windsurf and Cursor IDEs
- **SSE Transport**: Real-time Server-Sent Events for MCP communication
- **JSON-RPC Support**: Direct tool calls via HTTP POST endpoints
- **Comprehensive Tools**: 26+ tools for project management, user stories, and persona analysis
- **IDE Integration**: Native support for Windsurf and Cursor IDEs

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.oauth.example .env.oauth
   # Edit .env.oauth with your settings
   ```

3. **Start the server:**
   ```bash
   node mcp-server-rezoomex-oauth.js
   ```

4. **Configure your IDE:**
   Add to Windsurf MCP config:
   ```json
   {
     "mcpServers": {
       "rzmx": {
         "url": "http://localhost:3000/v1/sse"
       }
     }
   }
   ```

## OAuth2 Flow

The server provides OAuth2 endpoints for IDE integration:

- `GET /authorize` - Authorization endpoint with login form
- `POST /authenticate` - Credential authentication
- `GET /callback` - OAuth2 callback handler
- `POST /token` - Token exchange endpoint

## MCP Endpoints

- `GET /v1/sse` - SSE transport for real-time MCP communication
- `POST /v1/sse` - JSON-RPC endpoint for direct tool calls

## Available Tools

### Core Project Tools
- `list_user_stories` - List user stories for project and persona
- `get_user_story` - Get specific user story details
- `get_projects` - Get all accessible projects
- `get_project_overview` - Comprehensive project information
- `get_persona_profile` - Detailed persona analysis

### Advanced Tools
- `get_story_range` - Get multiple stories by range
- `get_user_journey` - User journey mapping
- `get_jobs_to_be_done` - JTBD analysis
- `search_projects` - Project search functionality
- `find_project_by_name` - Project discovery by name

### User Management
- `get_user_info` - Authenticated user profile
- `check_nda_status` - NDA compliance status

*And 15+ additional tools for comprehensive project management*

## Environment Configuration

```bash
# .env.oauth
NODE_ENV=development
PORT=3000
BASE_URI=http://localhost:3000
REZOOMEX_BASE_URL=https://awsapi-gateway.rezoomex.com
REZOOMEX_LOGIN_URL=https://workspace.rezoomex.com/account/login
LOG_LEVEL=info
```

## Architecture

```
├── lib/
│   ├── auth-manager.js     # Authentication management
│   ├── mcp-tools.js        # 26+ tool definitions
│   └── rezoomex-client.js  # Rezoomex API client
├── views/
│   ├── dashboard.html      # OAuth dashboard
│   └── index.html          # Server info page
├── mcp-server-rezoomex-oauth.js  # Main OAuth MCP server
├── server.js               # Legacy HTTP server
└── windsurf_mcp_config_oauth.json  # IDE configuration
```

## Development

The server supports both SSE transport and direct JSON-RPC calls, making it compatible with various MCP clients and IDEs.

### Adding Tools

1. Add tool definition to `lib/mcp-tools.js`
2. Implement logic in the tool's `callTool` method
3. Tools are automatically available in both SSE and JSON-RPC endpoints

## Deployment

The server can be deployed to any Node.js hosting platform. See `DEPLOYMENT.md` for detailed deployment instructions.

## License

Proprietary to Rezoomex.
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
