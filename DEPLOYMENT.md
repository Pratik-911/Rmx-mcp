# Rezoomex MCP Server - Render Deployment Guide

## Quick Deploy to Render

### Option 1: Using render.yaml (Recommended)

1. **Fork/Clone this repository** to your GitHub account

2. **Connect to Render:**
   - Go to [render.com](https://render.com)
   - Sign up/Login with GitHub
   - Click "New" → "Web Service"
   - Connect your GitHub repository

3. **Automatic Configuration:**
   - Render will automatically detect the `render.yaml` file
   - All environment variables are pre-configured
   - Click "Deploy"

### Option 2: Manual Setup

1. **Create Web Service:**
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`

2. **Environment Variables:**
   ```
   NODE_ENV=production
   PORT=10000
   REZOOMEX_BASE_URL=https://awsapi-gateway.rezoomex.com
   REZOOMEX_LOGIN_URL=https://workspace.rezoomex.com/account/login
   LOG_LEVEL=info
   RATE_LIMIT_WINDOW_MS=900000
   RATE_LIMIT_MAX_REQUESTS=100
   CORS_ORIGIN=*
   ```

## Post-Deployment

### 1. Get Your Deployment URL
After deployment, you'll get a URL like: `https://your-app-name.onrender.com`

### 2. Update Windsurf MCP Config
Update your `windsurf_mcp_config.json`:

```json
{
  "mcpServers": {
    "rezoomex-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "https://your-app-name.onrender.com/sse"]
    }
  }
}
```

### 3. Test the Deployment

**Health Check:**
```bash
curl https://your-app-name.onrender.com/health
```

**Authentication Test:**
```bash
curl -X POST https://your-app-name.onrender.com/sse \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "authenticate",
      "arguments": {
        "email": "your-email@example.com",
        "password": "your-password"
      }
    }
  }'
```

## Features Available

✅ **SSE-based MCP Protocol** - Cloud-compatible  
✅ **Authentication** - Direct Rezoomex login  
✅ **Session Management** - Persistent across tool calls  
✅ **All MCP Tools** - Complete Rezoomex API integration  
✅ **Error Handling** - Comprehensive logging  
✅ **Rate Limiting** - Production-ready  

## Troubleshooting

### Common Issues

1. **Port Issues:** Render uses port 10000 by default
2. **CORS Errors:** Set `CORS_ORIGIN=*` for development
3. **Authentication Failures:** Check Rezoomex API credentials
4. **Session Timeouts:** Re-authenticate if needed

### Logs Access
- View logs in Render dashboard
- Check `/health` endpoint for server status
- Monitor authentication events

## Security Notes

- Environment variables are secure in Render
- HTTPS is automatically enabled
- Session tokens are memory-only (not persistent)
- Rate limiting prevents abuse

## Support

For issues with:
- **MCP Integration:** Check Windsurf documentation
- **Rezoomex API:** Verify credentials and endpoints
- **Render Deployment:** Check Render logs and status
