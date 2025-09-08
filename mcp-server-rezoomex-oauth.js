#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from './lib/auth-manager.js';
import { MCPTools } from './lib/mcp-tools.js';
import { createLogger, format, transports } from 'winston';
import { config } from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env.oauth
config({ path: '.env.oauth' });

// Setup logger
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    transports: [
        new transports.File({ 
            filename: 'mcp-server-rezoomex-oauth.log',
            maxsize: 5242880,
            maxFiles: 5
        }),
        new transports.Console({
            format: format.simple()
        })
    ]
});

const app = express();

// Configure trust proxy for production deployment (Render, Heroku, etc.)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
} else {
    app.set('trust proxy', false);
}

const PORT = process.env.PORT || 3000;
const BASE_URI = process.env.BASE_URI || (process.env.NODE_ENV === 'production' ? 'https://rmx-mcp.onrender.com' : `http://localhost:${PORT}`);
const REZOOMEX_LOGIN_URL = process.env.REZOOMEX_LOGIN_URL || 'https://workspace.rezoomex.com/account/login';
const REZOOMEX_BASE_URL = process.env.REZOOMEX_BASE_URL || 'https://awsapi-gateway.rezoomex.com';

// Auth0 Configuration
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;

// Auth0 OAuth2 Provider
class Auth0Provider {
    constructor(domain, clientId, clientSecret, logger) {
        this.domain = domain;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.logger = logger;
    }

    getAuthorizationUrl(redirectUri, state, scope = 'openid profile email') {
        const authUrl = new URL(`https://${this.domain}/authorize`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', this.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('scope', scope);
        if (state) authUrl.searchParams.set('state', state);
        return authUrl.toString();
    }

    async exchangeCodeForToken(code, redirectUri) {
        try {
            const tokenResponse = await axios.post(`https://${this.domain}/oauth/token`, {
                grant_type: 'authorization_code',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code,
                redirect_uri: redirectUri
            }, {
                headers: { 'Content-Type': 'application/json' }
            });

            return tokenResponse.data;
        } catch (error) {
            this.logger.error('Auth0 token exchange failed', { error: error.message });
            throw new Error('Token exchange failed');
        }
    }

    async getUserInfo(accessToken) {
        try {
            const userResponse = await axios.get(`https://${this.domain}/userinfo`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            return userResponse.data;
        } catch (error) {
            this.logger.error('Auth0 user info fetch failed', { error: error.message });
            throw new Error('Failed to fetch user info');
        }
    }

    async verifyAccessToken(token) {
        try {
            const userInfo = await this.getUserInfo(token);
            return {
                token,
                clientId: this.clientId,
                scopes: ['read', 'write'],
                extra: {
                    userId: userInfo.sub,
                    email: userInfo.email,
                    name: userInfo.name
                },
                expiresAt: Date.now() + 3600000 // 1 hour
            };
        } catch (error) {
            this.logger.error('Auth0 token verification failed', { error: error.message });
            throw new Error('Invalid access token');
        }
    }
}

// In-memory session storage
const sessionStore = new Map();
const mcpTransports = new Map();
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 300000; // 5 minutes default

// Middleware
const corsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', "Mcp-Protocol-Version", "Mcp-Protocol-Id", "Mcp-Session-Id"],
    exposedHeaders: ["Mcp-Protocol-Version", "Mcp-Protocol-Id"],
    credentials: true
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Add middleware for parsing form data
app.use(express.urlencoded({ extended: true }));

// Initialize providers and managers
const authManager = new AuthManager(logger);
const mcpTools = new MCPTools();

// Initialize Auth0 provider if configured
const auth0Provider = (AUTH0_DOMAIN && AUTH0_CLIENT_ID && AUTH0_CLIENT_SECRET) 
    ? new Auth0Provider(AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, logger)
    : null;

// Rezoomex authentication provider
class RezoomexAuthProvider {
    constructor(logger) {
        this.logger = logger;
    }

    async verifyAccessToken(token) {
        try {
            // Verify token by calling Rezoomex API using the same endpoint as working server
            const response = await axios.get(`${REZOOMEX_BASE_URL}/v1/users/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            this.logger.info('Token verification successful', {
                status: response.status,
                hasUserData: !!response.data,
                userId: response.data?.id || response.data?.userId
            });

            if (!response.data) {
                throw new Error('Invalid token: no user data found');
            }

            return {
                token,
                clientId: 'rzmx',
                scopes: ['read', 'write'],
                extra: {
                    userId: response.data.id || response.data.userId,
                    email: response.data.email
                },
                expiresAt: Date.now() + 3600000 // 1 hour from now
            };
        } catch (error) {
            this.logger.error('Token verification failed', { 
                error: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                responseData: error.response?.data
            });
            throw new Error('Invalid access token');
        }
    }

    async authenticateWithCredentials(email, password) {
        try {
            // Use the correct Rezoomex authentication endpoint with form data
            const params = new URLSearchParams();
            params.append('username', email);
            params.append('password', password);

            this.logger.info('Attempting authentication', { email, endpoint: `${REZOOMEX_BASE_URL}/v1/users/auth0/token` });

            const response = await axios.post(`${REZOOMEX_BASE_URL}/v1/users/auth0/token`, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Rezoomex-MCP-Client/1.0'
                },
                timeout: 10000
            });

            this.logger.info('Authentication response received', { 
                status: response.status, 
                hasData: !!response.data,
                dataKeys: response.data ? Object.keys(response.data) : []
            });

            if (response.data && response.data.access_token) {
                return {
                    access_token: response.data.access_token,
                    token_type: 'Bearer'
                };
            }

            // Try alternative token field names
            if (response.data && response.data.token) {
                return {
                    access_token: response.data.token,
                    token_type: 'Bearer'
                };
            }

            throw new Error('No token received from authentication response');
        } catch (error) {
            const errorDetails = {
                email,
                status: error.response?.status,
                statusText: error.response?.statusText,
                responseData: error.response?.data,
                message: error.message
            };

            this.logger.error('Credential authentication failed', errorDetails);
            
            if (error.response?.status === 401) {
                throw new Error('Invalid email or password');
            } else if (error.response?.status === 404) {
                throw new Error('Authentication endpoint not found');
            } else if (error.code === 'ECONNREFUSED') {
                throw new Error('Cannot connect to Rezoomex API');
            } else {
                throw new Error(`Authentication failed: ${error.message}`);
            }
        }
    }

    async verifyToken(token) {
        try {
            const response = await axios.get(`${REZOOMEX_BASE_URL}/v1/users/me`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.status === 200;
        } catch (error) {
            this.logger.error('Token verification failed', { error: error.message });
            return false;
        }
    }
}

// Initialize the auth provider
const rezoomexAuthProvider = new RezoomexAuthProvider(logger);


// Create MCP Server
function createMcpServer(sessionContext) {
    const server = new Server(
        {
            name: "rzmx",
            version: "1.0.0",
        },
        {
            capabilities: {
                tools: {},
                resources: {}
            },
        }
    );

    // List tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // Import and use the comprehensive tool definitions from MCPTools
        const { MCPTools } = await import('./lib/mcp-tools.js');
        const mcpTools = new MCPTools();
        const allTools = mcpTools.getToolDefinitions();
        
        // Filter out the authenticate tool since OAuth handles authentication
        const availableTools = allTools.filter(tool => tool.name !== 'authenticate');
        
        return {
            tools: availableTools
        };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        
        if (!sessionContext?.accessToken) {
            throw new Error('Authentication required. Please authenticate first.');
        }

        try {
            const client = await authManager.authenticateWithToken(sessionContext.accessToken, sessionContext.sessionId || 'default');
            if (!client) {
                throw new Error('Failed to authenticate with token');
            }

            // Use MCPTools to handle all tool calls
            const { MCPTools } = await import('./lib/mcp-tools.js');
            const mcpTools = new MCPTools();
            
            // Skip authenticate tool since OAuth handles it
            if (name === 'authenticate') {
                throw new Error('Authentication is handled by OAuth2 flow');
            }
            
            const result = await mcpTools.callTool(name, args, client);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        } catch (error) {
            logger.error('Tool call error', { tool: name, error: error.message });
            throw error;
        }
    });

    return { server };
}

// OAuth2 authorization endpoint - handles both Auth0 and Rezoomex flows
app.get("/authorize", async (req, res) => {
    const { response_type, client_id, redirect_uri, state, scope, auth_provider } = req.query;
    
    logger.info('Authorization request received', { 
        response_type, 
        client_id, 
        redirect_uri: redirect_uri ? redirect_uri.substring(0, 50) + '...' : 'none',
        state,
        scope,
        authProvider: auth_provider
    });

    // Use Auth0 if configured and requested
    if (auth0Provider && (auth_provider === 'auth0' || client_id === AUTH0_CLIENT_ID)) {
        const authUrl = auth0Provider.getAuthorizationUrl(
            redirect_uri || `${BASE_URI}/callback`,
            state,
            scope || 'openid profile email'
        );
        
        logger.info('Redirecting to Auth0', { authUrl });
        return res.redirect(authUrl);
    }

    // Fall back to Rezoomex direct authentication form
    res.send(`
        <html>
          <head><title>Rezoomex Authentication</title></head>
          <body>
            <h1>Login to Rezoomex</h1>
            <p>Please enter your Rezoomex credentials:</p>
            <form method="post" action="/authenticate">
              <input type="hidden" name="state" value="${state || ''}" />
              <input type="hidden" name="redirect_uri" value="${redirect_uri || `${BASE_URI}/callback`}" />
              
              <div>
                <label for="email">Email:</label>
                <input type="email" id="email" name="email" required />
              </div>
              
              <div>
                <label for="password">Password:</label>
                <input type="password" id="password" name="password" required />
              </div>
              
              <button type="submit">Login</button>
            </form>
          </body>
        </html>
    `);
});

// OAuth2 client registration endpoint (for IDE compatibility)
app.post("/register", async (req, res) => {
    try {
        logger.info('Client registration request received', { 
            body: req.body,
            headers: req.headers 
        });
        
        const { client_name, redirect_uris } = req.body;
        
        if (!redirect_uris || !client_name) {
            logger.error('Missing required parameters', { client_name, redirect_uris });
            return res.status(400).json({ 
                error: 'invalid_client_metadata',
                error_description: 'Missing required parameters: redirect_uris and client_name' 
            });
        }

        const normalizedRedirectUris = Array.isArray(redirect_uris) ? redirect_uris : [redirect_uris];
        const dynamicCallbackUrl = normalizedRedirectUris[0];
        
        // Generate session ID for callback mapping
        const sessionId = Math.random().toString(36).substring(2, 15);
        sessionStore.set(`callback_session:${sessionId}`, dynamicCallbackUrl);
        
        setTimeout(() => {
            sessionStore.delete(`callback_session:${sessionId}`);
        }, SESSION_TIMEOUT);
        
        logger.info('Stored callback mapping', { 
            sessionId, 
            dynamicCallbackUrl,
            proxyCallbackUrl: `${BASE_URI}/callback`
        });
        
        // Return static client info (we don't use dynamic registration with Rezoomex)
        res.json({
            client_id: 'rezoomex-mcp-client',
            client_secret: 'not-used-for-rezoomex',
            client_name: client_name,
            redirect_uris: [`${BASE_URI}/callback`],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "client_secret_post"
        });
    } catch (error) {
        logger.error('Client registration failed', { error: error.message });
        res.status(500).json({ 
            error: 'server_error',
            error_description: 'Failed to register client' 
        });
    }
});

// Authorization endpoint - redirect to Rezoomex login (like reference MCP)
app.get("/authorize", (req, res) => {
    const { state, redirect_uri, client_id } = req.query;
    
    logger.info('Authorization request received', { 
        state, 
        redirectUri: redirect_uri,
        clientId: client_id
    });
    
    // For direct MCP auth, show login form
    if (state === 'mcp-auth') {
        res.send(`
            <html>
              <head>
                <title>Rezoomex Authentication</title>
                <style>
                  body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
                  .form-group { margin-bottom: 15px; }
                  label { display: block; margin-bottom: 5px; font-weight: bold; }
                  input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
                  button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%; }
                  button:hover { background: #005a87; }
                </style>
              </head>
              <body>
                <h2>Rezoomex MCP Authentication</h2>
                <p>Please enter your Rezoomex credentials:</p>
                <form method="post" action="/authenticate">
                  <input type="hidden" name="state" value="${state}" />
                  <input type="hidden" name="redirect_uri" value="${redirect_uri || `${BASE_URI}/callback`}" />
                  
                  <div class="form-group">
                    <label for="email">Email:</label>
                    <input type="email" id="email" name="email" required />
                  </div>
                  
                  <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required />
                  </div>
                  
                  <button type="submit">Sign In</button>
                </form>
                
                <p><small>Authenticating with: ${REZOOMEX_BASE_URL}</small></p>
              </body>
            </html>
        `);
        return;
    }
    
    // For IDE callbacks, store session and redirect to login form
    const sessionId = Math.random().toString(36).substring(2, 15);
    sessionStore.set(`auth_session:${sessionId}`, { 
        originalState: state, 
        redirectUri: redirect_uri,
        clientId: client_id
    });
    
    setTimeout(() => {
        sessionStore.delete(`auth_session:${sessionId}`);
    }, SESSION_TIMEOUT);
    
    // Redirect to login form with session ID
    const loginUrl = new URL(`${BASE_URI}/authorize`);
    loginUrl.searchParams.set('state', 'mcp-auth');
    loginUrl.searchParams.set('redirect_uri', `${BASE_URI}/callback?session=${sessionId}`);
    
    logger.info('Redirecting to login form', { 
        sessionId,
        loginUrl: loginUrl.toString()
    });
    
    res.redirect(loginUrl.toString());
});

// Authentication form handler
app.post("/authenticate", async (req, res) => {
    try {
        const { email, password, state, redirect_uri } = req.body;
        
        logger.info('Authentication attempt', { email, hasPassword: !!password, state });
        
        // Authenticate with Rezoomex
        const tokenData = await rezoomexAuthProvider.authenticateWithCredentials(email, password);
        
        // Create authorization code for the token
        const authCode = Math.random().toString(36).substring(2, 15);
        sessionStore.set(`auth_code:${authCode}`, tokenData.access_token);
        setTimeout(() => {
            sessionStore.delete(`auth_code:${authCode}`);
        }, SESSION_TIMEOUT);
        
        // Handle direct MCP auth vs IDE callback
        if (state === 'mcp-auth') {
            // Check if this is a session callback
            const url = new URL(redirect_uri, BASE_URI);
            const sessionId = url.searchParams.get('session');
            
            if (sessionId) {
                // Get original callback info
                const sessionData = sessionStore.get(`auth_session:${sessionId}`);
                if (sessionData) {
                    const params = new URLSearchParams();
                    params.set('code', authCode);
                    if (sessionData.originalState) {
                        params.set('state', sessionData.originalState);
                    }
                    
                    const finalCallbackUrl = `${sessionData.redirectUri}?${params.toString()}`;
                    
                    logger.info('Redirecting to IDE callback', { 
                        sessionId,
                        finalCallbackUrl: finalCallbackUrl.substring(0, 100) + '...'
                    });
                    
                    sessionStore.delete(`auth_session:${sessionId}`);
                    res.redirect(finalCallbackUrl);
                    return;
                }
            }
            
            // Direct MCP auth - show success page
            res.send(`
                <html>
                  <head><title>Authentication Successful</title></head>
                  <body>
                    <h1>Authentication Successful!</h1>
                    <p>You have successfully authenticated with Rezoomex.</p>
                    <p>Authorization code: <code>${authCode}</code></p>
                    <p>You can now close this window and return to your IDE.</p>
                  </body>
                </html>
            `);
            return;
        }
        
        // Standard OAuth callback
        const params = new URLSearchParams();
        params.set('code', authCode);
        if (state) {
            params.set('state', state);
        }
        
        const callbackUrl = `${redirect_uri}?${params.toString()}`;
        
        logger.info('Authentication successful, redirecting', { 
            email, 
            callbackUrl: callbackUrl.substring(0, 100) + '...' 
        });
        
        res.redirect(callbackUrl);
        
    } catch (error) {
        logger.error('Authentication failed', { error: error.message });
        
        // Show form again with error
        const { state, redirect_uri } = req.body;
        res.send(`
            <html>
              <head>
                <title>Rezoomex Authentication - Error</title>
                <style>
                  body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
                  .form-group { margin-bottom: 15px; }
                  label { display: block; margin-bottom: 5px; font-weight: bold; }
                  input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
                  button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%; }
                  button:hover { background: #005a87; }
                  .error { color: red; margin: 15px 0; padding: 10px; background: #ffebee; border-radius: 4px; }
                </style>
              </head>
              <body>
                <h2>Rezoomex MCP Authentication</h2>
                <div class="error">Authentication failed: ${error.message}</div>
                <p>Please try again with your Rezoomex credentials:</p>
                <form method="post" action="/authenticate">
                  <input type="hidden" name="state" value="${state || ''}" />
                  <input type="hidden" name="redirect_uri" value="${redirect_uri || ''}" />
                  
                  <div class="form-group">
                    <label for="email">Email:</label>
                    <input type="email" id="email" name="email" required />
                  </div>
                  
                  <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required />
                  </div>
                  
                  <button type="submit">Sign In</button>
                </form>
                
                <p><small>Authenticating with: ${REZOOMEX_BASE_URL}</small></p>
              </body>
            </html>
        `);
    }
});

// OAuth2 token exchange endpoint
app.post("/token", async (req, res) => {
    try {
        const { grant_type, code, redirect_uri, client_id, client_secret } = req.body;
        
        logger.info('Token exchange request', { grant_type, client_id, hasCode: !!code });

        if (grant_type !== 'authorization_code') {
            return res.status(400).json({
                error: 'unsupported_grant_type',
                error_description: 'Only authorization_code grant type is supported'
            });
        }

        if (!code) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'Missing authorization code'
            });
        }

        // Use Auth0 token exchange if Auth0 client
        if (auth0Provider && client_id === AUTH0_CLIENT_ID) {
            try {
                const tokenData = await auth0Provider.exchangeCodeForToken(code, redirect_uri);
                
                logger.info('Auth0 token exchange successful');
                return res.json({
                    access_token: tokenData.access_token,
                    token_type: 'Bearer',
                    expires_in: tokenData.expires_in || 3600,
                    scope: tokenData.scope
                });
            } catch (error) {
                logger.error('Auth0 token exchange failed', { error: error.message });
                return res.status(400).json({
                    error: 'invalid_grant',
                    error_description: 'Authorization code is invalid or expired'
                });
            }
        }

        // Handle Rezoomex authorization codes
        const authCode = sessionStore.get(`auth_code:${code}`);
        if (!authCode) {
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Authorization code is invalid or expired'
            });
        }

        // Clean up used code
        sessionStore.delete(`auth_code:${code}`);

        logger.info('Token exchange successful for Rezoomex auth');
        res.json({
            access_token: authCode.access_token,
            token_type: 'Bearer',
            expires_in: 3600
        });

    } catch (error) {
        logger.error('Token exchange error', { error: error.message });
        res.status(500).json({
            error: 'server_error',
            error_description: 'Internal server error during token exchange'
        });
    }
});

// OAuth callback endpoint - handles both Auth0 and Rezoomex callbacks
app.get("/callback", async (req, res) => {
    try {
        const { state, code, token, session } = req.query;
        
        logger.info('Callback received', { state, hasCode: !!code, hasToken: !!token, session });
        
        // Handle session-based callback (from authenticate form)
        if (session) {
            const sessionData = sessionStore.get(`auth_session:${session}`);
            if (sessionData && code) {
                const params = new URLSearchParams();
                params.set('code', code);
                if (sessionData.originalState) {
                    params.set('state', sessionData.originalState);
                }
                
                const finalCallbackUrl = `${sessionData.redirectUri}?${params.toString()}`;
                
                logger.info('Session callback redirect', { 
                    session,
                    finalCallbackUrl: finalCallbackUrl.substring(0, 100) + '...'
                });
                
                sessionStore.delete(`auth_session:${session}`);
                res.redirect(finalCallbackUrl);
                return;
            }
        }
        
        // Handle direct MCP auth callback
        if (state === 'mcp-auth') {
            res.send(`
                <html>
                  <head><title>Authentication Complete</title></head>
                  <body>
                    <h1>Authentication Complete!</h1>
                    <p>You have successfully authenticated with Rezoomex.</p>
                    <p>You can close this window and return to your IDE.</p>
                  </body>
                </html>
            `);
            return;
        }
        
        // Default success page
        res.send(`
            <html>
              <head><title>Authentication Complete</title></head>
              <body>
                <h1>Authentication Complete!</h1>
                <p>You can close this window and return to your IDE.</p>
              </body>
            </html>
        `);
    } catch (error) {
        logger.error('Callback error', { error: error.message });
        res.status(500).send('Callback failed');
    }
});

// OAuth token exchange endpoint
app.post("/token", async (req, res) => {
    try {
        const {
            grant_type,
            code,
            redirect_uri,
            client_id,
            username,
            password
        } = req.body;

        logger.info('Token exchange request', {
            grant_type,
            code: code?.substring(0, 10) + '...',
            redirect_uri,
            client_id,
            hasCredentials: !!(username && password)
        });

        if (grant_type !== 'authorization_code') {
            return res.status(400).json({
                error: 'unsupported_grant_type',
                error_description: 'Only authorization_code grant type is supported'
            });
        }

        if (!code || !client_id) {
            return res.status(400).json({
                error: 'invalid_request',
                error_description: 'Missing required parameters'
            });
        }

        // Exchange the authorization code for the stored token
        const storedToken = sessionStore.get(`auth_code:${code}`);
        if (!storedToken) {
            logger.error('Authorization code not found or expired', { code: code?.substring(0, 10) + '...' });
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Authorization code is invalid or expired'
            });
        }

        // Verify the token is still valid before returning it
        try {
            const isValid = await rezoomexAuthProvider.verifyToken(storedToken);
            if (!isValid) {
                logger.error('Stored token is no longer valid', { code: code?.substring(0, 10) + '...' });
                sessionStore.delete(`auth_code:${code}`);
                return res.status(400).json({
                    error: 'invalid_grant',
                    error_description: 'Authorization code token is no longer valid'
                });
            }
        } catch (error) {
            logger.error('Token validation failed during exchange', { error: error.message });
            sessionStore.delete(`auth_code:${code}`);
            return res.status(400).json({
                error: 'invalid_grant',
                error_description: 'Token validation failed'
            });
        }

        // Clean up the authorization code
        sessionStore.delete(`auth_code:${code}`);

        logger.info('Token exchange successful', {
            hasToken: !!storedToken,
            tokenLength: storedToken?.length
        });

        // Return the token
        res.json({
            access_token: storedToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read write'
        });

    } catch (error) {
        logger.error('Token exchange error', { error: error.message });
        res.status(500).json({
            error: 'server_error',
            error_description: 'Internal server error during token exchange'
        });
    }
});

// SSE authentication middleware - supports both Auth0 and Rezoomex tokens
const sseAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Always redirect to authorization page for unauthenticated requests
        const authUrl = new URL(`${BASE_URI}/authorize`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', auth0Provider ? AUTH0_CLIENT_ID : 'rzmx-client');
        authUrl.searchParams.set('redirect_uri', `${BASE_URI}/callback`);
        authUrl.searchParams.set('state', 'mcp-auth');
        if (auth0Provider) authUrl.searchParams.set('auth_provider', 'auth0');
        
        logger.info('Redirecting to authorization', { authUrl: authUrl.toString() });
        res.redirect(authUrl.toString());
        return;
    }

    const token = authHeader.substring(7);
    try {
        let authInfo;
        
        // Try Auth0 first if configured
        if (auth0Provider) {
            try {
                authInfo = await auth0Provider.verifyAccessToken(token);
                logger.info('Auth0 token verified successfully');
            } catch (auth0Error) {
                logger.warn('Auth0 token verification failed, trying Rezoomex', { error: auth0Error.message });
                // Fall back to Rezoomex
                authInfo = await rezoomexAuthProvider.verifyAccessToken(token);
            }
        } else {
            // Use Rezoomex only
            authInfo = await rezoomexAuthProvider.verifyAccessToken(token);
        }
        
        req.authInfo = authInfo;
        req.sessionContext = {
            userId: authInfo.extra?.userId || `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            clientId: authInfo.clientId,
            accessToken: token,
            sessionId: `session_${authInfo.extra?.userId || 'anon'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
        };
        
        logger.info('User authenticated successfully (SSE)', {
            userId: authInfo.extra?.userId || 'unknown',
            clientId: authInfo.clientId,
            scopes: authInfo.scopes
        });
        
        next();
    } catch (error) {
        logger.error('SSE authentication failed', { error: error.message });
        
        // Redirect to authorization on auth failure
        const authUrl = new URL(`${BASE_URI}/authorize`);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('client_id', auth0Provider ? AUTH0_CLIENT_ID : 'rzmx-client');
        authUrl.searchParams.set('redirect_uri', `${BASE_URI}/callback`);
        authUrl.searchParams.set('state', 'mcp-auth');
        if (auth0Provider) authUrl.searchParams.set('auth_provider', 'auth0');
        
        res.redirect(authUrl.toString());
    }
};

// MCP SSE endpoint
const handleMcpSSE = async (req, res) => {
    logger.info('=== MCP SSE CONNECTION STARTING ===');
    
    try {
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        
        // Set up onclose handler to clean up transport when closed
        transport.onclose = () => {
            logger.info(`SSE transport closed for session ${sessionId}`);
            transports.delete(sessionId);
        };
        
        const sessionContext = req.sessionContext;
        const { server } = createMcpServer(sessionContext);
        await server.connect(transport);
        
        logger.info(`✅ Established SSE stream with session ID: ${sessionId}`);
    } catch (error) {
        logger.error('Error establishing SSE stream:', { error: error.message });
        if (!res.headersSent) {
            res.status(500).send('Error establishing SSE stream');
        }
    }
};


// MCP endpoints
app.get('/mcp', sseAuthMiddleware, handleMcpSSE);
app.get('/v1/sse', sseAuthMiddleware, handleMcpSSE);

// MCP v1 POST endpoint for JSON-RPC messages (required by Cursor)
app.post('/v1/sse', express.json(), async (req, res) => {
    logger.info('📨 Received POST request to /v1/sse (MCP v1 JSON-RPC)');
    
    try {
        // Handle authentication using existing rezoomexAuthProvider
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger.error('No Bearer token provided in POST /v1/sse');
            return res.status(401).json({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: 'Authentication required'
                },
                id: req.body?.id || null
            });
        }

        const token = authHeader.substring(7);
        const authInfo = await rezoomexAuthProvider.verifyAccessToken(token);
        
        // Log successful authentication
        logger.info('User authenticated for JSON-RPC request', {
            userId: authInfo.extra?.userId,
            clientId: authInfo.clientId,
            tokenPrefix: token.substring(0, 10) + '...'
        });
        
        // Process JSON-RPC request
        const jsonRpcRequest = req.body;
        logger.info('Processing JSON-RPC request', { 
            method: jsonRpcRequest?.method, 
            id: jsonRpcRequest?.id,
            userId: authInfo.extra?.userId 
        });

        // Handle JSON-RPC requests by providing responses for MCP methods
        let response;
        
        const method = jsonRpcRequest.method;
        
        if (method === 'initialize') {
            response = {
                jsonrpc: '2.0',
                id: jsonRpcRequest.id,
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        prompts: {},
                        resources: {},
                        tools: {},
                        logging: {}
                    },
                    serverInfo: {
                        name: 'rzmx',
                        version: '1.0.0'
                    }
                }
            };
        } else if (method === 'tools/list') {
            // Import and use the comprehensive tool definitions from MCPTools
            const { MCPTools } = await import('./lib/mcp-tools.js');
            const mcpTools = new MCPTools();
            const allTools = mcpTools.getToolDefinitions();
            
            // Filter out the authenticate tool since OAuth handles authentication
            const availableTools = allTools.filter(tool => tool.name !== 'authenticate');
            
            response = {
                jsonrpc: '2.0',
                id: jsonRpcRequest.id,
                result: {
                    tools: availableTools
                }
            };
        } else if (method === 'tools/call') {
            const toolName = jsonRpcRequest.params?.name;
            const toolArgs = jsonRpcRequest.params?.arguments || {};
            
            try {
                // Create user-specific session ID to prevent cross-user data access
                const userSpecificSessionId = `session_${authInfo.extra?.userId || 'anon'}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                const client = await authManager.authenticateWithToken(token, userSpecificSessionId);
                if (!client) {
                    throw new Error('Failed to authenticate with token');
                }
                
                // Use MCPTools to handle all tool calls
                const { MCPTools } = await import('./lib/mcp-tools.js');
                const mcpTools = new MCPTools();
                
                // Skip authenticate tool since OAuth handles it
                if (toolName === 'authenticate') {
                    throw new Error('Authentication is handled by OAuth2 flow');
                }
                
                const result = await mcpTools.callTool(toolName, toolArgs, client);
                
                response = {
                    jsonrpc: '2.0',
                    id: jsonRpcRequest.id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                    }
                };
            } catch (error) {
                logger.error('Tool call error', { tool: toolName, error: error.message });
                response = {
                    jsonrpc: '2.0',
                    id: jsonRpcRequest.id,
                    error: {
                        code: -32603,
                        message: error.message
                    }
                };
            }
        } else {
            response = {
                jsonrpc: '2.0',
                id: jsonRpcRequest.id,
                error: {
                    code: -32601,
                    message: `Method not found: ${method}`
                }
            };
        }
        
        logger.info('Sending JSON-RPC response', { 
            method: jsonRpcRequest?.method,
            id: jsonRpcRequest?.id,
            success: !response.error
        });
        
        res.json(response);
        
    } catch (error) {
        logger.error('JSON-RPC endpoint error', { error: error.message });
        res.status(500).json({
            jsonrpc: '2.0',
            error: {
                code: -32603,
                message: 'Internal error'
            },
            id: req.body?.id || null
        });
    }
});

// Health check
app.get("/health", (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        rezoomexLoginUrl: REZOOMEX_LOGIN_URL,
        rezoomexBaseUrl: REZOOMEX_BASE_URL
    });
});

// Landing page with authentication info
app.get("/", (req, res) => {
    res.send(`
        <html>
          <head><title>Rezoomex MCP Server</title></head>
          <body>
            <h1>RZMX MCP Server</h1>
            <p>This server provides MCP (Model Context Protocol) access to Rezoomex APIs.</p>
            <h2>Authentication</h2>
            <p>This server authenticates against: <a href="${REZOOMEX_LOGIN_URL}">${REZOOMEX_LOGIN_URL}</a></p>
            <p>API Base URL: ${REZOOMEX_BASE_URL}</p>
            <h2>Endpoints</h2>
            <ul>
              <li><a href="/health">Health Check</a></li>
              <li><a href="/mcp">MCP SSE Endpoint</a></li>
              <li><a href="/v1/sse">MCP v1 SSE Endpoint</a></li>
            </ul>
          </body>
        </html>
    `);
});

// Start server
app.listen(PORT, () => {
logger.info('Rezoomex OAuth2 MCP Server started', {
port: PORT,
baseUri: BASE_URI,
rezoomexLoginUrl: REZOOMEX_LOGIN_URL,
rezoomexBaseUrl: REZOOMEX_BASE_URL,
environment: process.env.NODE_ENV || 'development',
version: '2.0.0'
});
});
