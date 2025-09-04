#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import { config } from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { createLogger, format, transports } from 'winston';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

import { RezoomexApiClient } from './lib/rezoomex-client.js';
import { AuthManager } from './lib/auth-manager.js';
import { MCPTools } from './lib/mcp-tools.js';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure logs directory exists
const logsDir = join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Configure Winston logger
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'rezoomex-mcp-server' },
    transports: [
        new transports.File({ 
            filename: process.env.LOG_FILE || join(logsDir, 'rezoomex-mcp.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        })
    ]
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files from views directory
app.use(express.static(path.join(__dirname, 'views')));

// Initialize managers
const authManager = new AuthManager(logger);
const mcpTools = new MCPTools();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow SSE
}));

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request logging middleware
app.use((req, res, next) => {
    const sessionId = req.headers['x-session-id'] || 'anonymous';
    logger.info('Incoming request', {
        method: req.method,
        url: req.url,
        sessionId,
        userAgent: req.headers['user-agent'],
        ip: req.ip
    });
    next();
});

// Web interface routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// OAuth callback route for token extraction
app.get('/auth/callback', (req, res) => {
    const { access_token, error } = req.query;
    
    if (error) {
        logger.error('OAuth callback error', { error });
        return res.redirect('/?error=' + encodeURIComponent(error));
    }
    
    if (access_token) {
        // Store token temporarily for pickup
        const tempTokenId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        authManager.storeTempToken(tempTokenId, access_token);
        
        // Redirect to success page with temp token ID
        return res.redirect(`/?token_id=${tempTokenId}&success=1`);
    }
    
    res.redirect('/?error=no_token');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Authentication endpoint - returns login URL
app.get('/auth/login-url', (req, res) => {
    const baseUrl = req.protocol + '://' + req.get('host');
    const callbackUrl = `${baseUrl}/auth/callback`;
    const loginUrl = `https://workspace.rezoomex.com/account/login?redirect_uri=${encodeURIComponent(callbackUrl)}`;
    
    res.json({ loginUrl, callbackUrl });
});

// Authentication endpoint - returns login URL
app.get('/auth/login-url', (req, res) => {
    const loginUrl = process.env.REZOOMEX_LOGIN_URL || 'https://workspace.rezoomex.com/account/login';
    
    logger.info('Login URL requested');
    
    res.json({
        loginUrl,
        instructions: 'Please login at the provided URL and extract the bearer token from the URL after successful authentication.',
        tokenLocation: 'The bearer token will be in the URL as access_token parameter after login.'
    });
});

// Direct credential authentication endpoint
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        // Authenticate with Rezoomex API endpoint (same as working Python MCP)
        const params = new URLSearchParams();
        params.append('username', email);
        params.append('password', password);
        
        const authResponse = await axios.post('https://awsapi-gateway.rezoomex.com/v1/users/auth0/token', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        if (authResponse.data.access_token) {
            const sessionId = uuidv4();
            const client = await authManager.authenticateWithToken(authResponse.data.access_token, sessionId);
            
            if (!client) {
                throw new Error('Failed to authenticate with received token');
            }
            
            const userInfo = client.userInfo;
            
            logger.info('User authenticated via credentials', { 
                sessionId, 
                userEmail: userInfo?.email 
            });
            
            res.json({
                message: 'Authentication successful',
                sessionId,
                user: userInfo,
                accessToken: authResponse.data.access_token
            });
        } else {
            throw new Error('No access token received');
        }
    } catch (error) {
        logger.error('Credential authentication failed', { error: error.message });
        res.status(401).json({ 
            error: 'Authentication failed: ' + (error.response?.data?.error_description || error.message)
        });
    }
});

// Bearer token authentication endpoint
app.post('/auth/token', async (req, res) => {
    try {
        const { bearerToken } = req.body;
        
        if (!bearerToken) {
            return res.status(400).json({ error: 'Bearer token is required' });
        }
        
        const sessionId = uuidv4();
        const client = await authManager.authenticateWithToken(bearerToken, sessionId);
        
        if (!client) {
            throw new Error('Invalid bearer token');
        }
        
        const userInfo = client.userInfo;
        
        logger.info('User authenticated successfully', { 
            sessionId, 
            userEmail: userInfo?.email 
        });
        
        res.json({
            message: 'Authentication successful',
            sessionId,
            user: userInfo,
            loginUrl: process.env.REZOOMEX_LOGIN_URL || 'https://workspace.rezoomex.com/login'
        });
    } catch (error) {
        logger.error('Authentication failed', { error: error.message });
        res.status(401).json({ 
            error: 'Authentication failed: ' + error.message,
            loginUrl: process.env.REZOOMEX_LOGIN_URL || 'https://workspace.rezoomex.com/login'
        });
    }
});

// Get authentication status
app.get('/auth/status', (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.cookies.sessionId;
    
    if (!sessionId || !authManager.isValidSession(sessionId)) {
        return res.json({ authenticated: false });
    }
    
    try {
        const userInfo = authManager.getUserInfo(sessionId);
        res.json({
            authenticated: true,
            sessionId,
            user: userInfo
        });
    } catch (error) {
        res.json({ authenticated: false });
    }
});

// Pickup temporary token (for OAuth flow)
app.post('/auth/pickup-token', async (req, res) => {
    try {
        const { tempTokenId } = req.body;
        
        if (!tempTokenId) {
            return res.status(400).json({ error: 'Temporary token ID is required' });
        }
        
        const bearerToken = authManager.getTempToken(tempTokenId);
        if (!bearerToken) {
            return res.status(404).json({ error: 'Token not found or expired' });
        }
        
        // Authenticate with the token
        const sessionId = await authManager.authenticate(bearerToken);
        const userInfo = await authManager.getUserInfo(sessionId);
        
        // Clean up temp token
        authManager.removeTempToken(tempTokenId);
        
        logger.info('OAuth token pickup successful', { 
            sessionId, 
            userEmail: userInfo?.email 
        });
        
        res.json({
            success: true,
            sessionId,
            user: userInfo
        });
    } catch (error) {
        logger.error('Token pickup failed', { error: error.message });
        res.status(401).json({ 
            error: 'Token pickup failed: ' + error.message
        });
    }
});

// MCP Tools listing endpoint
app.get('/mcp/tools', (req, res) => {
    const tools = mcpTools.getToolDefinitions();
    logger.info('MCP tools requested', { toolCount: tools.length });
    
    res.json({
        tools,
        count: tools.length,
        version: '1.0.0'
    });
});

// SSE endpoint for MCP tool execution
app.get('/mcp/execute/:toolName', async (req, res) => {
    const { toolName } = req.params;
    const sessionId = req.headers['x-session-id'];
    const queryParams = req.query;

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const sendError = (error, code = 'EXECUTION_ERROR') => {
        logger.error('Tool execution error', { toolName, sessionId, error: error.message });
        sendEvent('error', {
            error: code,
            message: error.message,
            timestamp: new Date().toISOString()
        });
    };

    const sendProgress = (message, progress = null) => {
        sendEvent('progress', {
            message,
            progress,
            timestamp: new Date().toISOString()
        });
    };

    const sendResult = (result) => {
        sendEvent('result', {
            result,
            timestamp: new Date().toISOString()
        });
    };

    const sendComplete = () => {
        sendEvent('complete', {
            timestamp: new Date().toISOString()
        });
        res.end();
    };

    try {
        logger.info('Tool execution started', { toolName, sessionId, params: queryParams });

        // Check if tool exists
        if (!mcpTools.hasTools(toolName)) {
            sendError(new Error(`Unknown tool: ${toolName}`), 'UNKNOWN_TOOL');
            sendComplete();
            return;
        }

        // Get authenticated client
        sendProgress('Authenticating...');
        const client = await authManager.getClient(sessionId);
        
        if (!client) {
            sendError(new Error('Authentication required. Please authenticate first using /auth/token endpoint.'), 'AUTH_REQUIRED');
            sendComplete();
            return;
        }

        // Validate session
        sendProgress('Validating session...');
        const isValid = await client.validateSession();
        if (!isValid) {
            authManager.clearSession(sessionId);
            sendError(new Error('Session expired. Please re-authenticate.'), 'SESSION_EXPIRED');
            sendComplete();
            return;
        }

        // Execute tool
        sendProgress(`Executing ${toolName}...`);
        const result = await executeToolWithProgress(client, toolName, queryParams, sendProgress);
        
        sendResult(result);
        sendComplete();

        logger.info('Tool execution completed', { toolName, sessionId });

    } catch (error) {
        sendError(error);
        sendComplete();
    }

    // Handle client disconnect
    req.on('close', () => {
        logger.info('Client disconnected', { toolName, sessionId });
    });
});

// POST endpoint for MCP tool execution (alternative to SSE)
app.post('/mcp/execute/:toolName', async (req, res) => {
    const { toolName } = req.params;
    const sessionId = req.headers['x-session-id'];
    const params = req.body;

    try {
        logger.info('Tool execution started (POST)', { toolName, sessionId, params });

        // Check if tool exists
        if (!mcpTools.hasTools(toolName)) {
            return res.status(400).json({
                error: 'UNKNOWN_TOOL',
                message: `Unknown tool: ${toolName}`
            });
        }

        // Get authenticated client
        const client = await authManager.getClient(sessionId);
        
        if (!client) {
            return res.status(401).json({
                error: 'AUTH_REQUIRED',
                message: 'Authentication required. Please authenticate first using /auth/token endpoint.'
            });
        }

        // Validate session
        const isValid = await client.validateSession();
        if (!isValid) {
            authManager.clearSession(sessionId);
            return res.status(401).json({
                error: 'SESSION_EXPIRED',
                message: 'Session expired. Please re-authenticate.'
            });
        }

        // Execute tool
        const result = await executeToolWithProgress(client, toolName, params);
        
        res.json({
            success: true,
            result,
            timestamp: new Date().toISOString()
        });

        logger.info('Tool execution completed (POST)', { toolName, sessionId });

    } catch (error) {
        logger.error('Tool execution error (POST)', { toolName, sessionId, error: error.message });
        res.status(500).json({
            error: 'EXECUTION_ERROR',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Session management endpoints
app.get('/auth/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const client = authManager.getClient(sessionId);
    
    if (client) {
        res.json({
            valid: true,
            sessionId,
            authenticated: true
        });
    } else {
        res.status(404).json({
            valid: false,
            message: 'Session not found'
        });
    }
});

app.delete('/auth/session', (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.cookies.sessionId;
    
    if (sessionId) {
        authManager.clearSession(sessionId);
        logger.info('Session cleared', { sessionId });
    }
    
    res.clearCookie('sessionId');
    res.json({
        message: 'Session cleared successfully'
    });
});

// Tool execution helper function
async function executeToolWithProgress(client, toolName, params, progressCallback = null) {
    const progress = progressCallback || (() => {});
    
    switch (toolName) {
        case 'list_user_stories':
            if (!params.project_id || !params.persona_id) {
                throw new Error('project_id and persona_id are required');
            }
            progress('Fetching user stories...');
            return await client.getUserStories(params.project_id, params.persona_id);
            
        case 'get_story_range':
            if (!params.project_id || !params.persona_id || !params.start_number || !params.end_number) {
                throw new Error('project_id, persona_id, start_number, and end_number are required');
            }
            progress('Fetching story range...');
            return await client.getStoryRange(
                params.project_id,
                params.persona_id,
                parseInt(params.start_number),
                parseInt(params.end_number)
            );
            
        case 'get_single_story_details':
            if (!params.project_id || !params.persona_id) {
                throw new Error('project_id and persona_id are required');
            }
            progress('Fetching story details...');
            return await client.getSingleStoryDetails(
                params.project_id,
                params.persona_id,
                params.story_number ? parseInt(params.story_number) : null,
                params.story_id
            );
            
        case 'get_project_overview':
            if (!params.project_id) {
                throw new Error('project_id is required');
            }
            progress('Fetching project overview...');
            return await client.getProjectOverview(params.project_id);
            
        case 'get_persona_profile':
            if (!params.project_id || !params.persona_id) {
                throw new Error('project_id and persona_id are required');
            }
            progress('Fetching persona profile...');
            return await client.getPersonaProfile(params.project_id, params.persona_id);
            
        case 'get_user_journey':
            if (!params.project_id || !params.persona_id) {
                throw new Error('project_id and persona_id are required');
            }
            progress('Fetching user journey...');
            return await client.getUserJourney(params.project_id, params.persona_id);
            
        case 'get_jobs_to_be_done':
            if (!params.project_id || !params.persona_id) {
                throw new Error('project_id and persona_id are required');
            }
            progress('Fetching jobs to be done...');
            return await client.getJobsToBeDone(params.project_id, params.persona_id);
            
        case 'get_user_info':
            progress('Fetching user info...');
            return await client.getUserInfo();
            
        case 'get_project_environment':
            if (!params.project_id) {
                throw new Error('project_id is required');
            }
            progress('Fetching project environment...');
            return await client.getProjectEnvironment(params.project_id);
            
        case 'check_nda_status':
            progress('Checking NDA status...');
            return await client.checkNdaStatus();
            
        case 'get_product_info':
            if (!params.project_id) {
                throw new Error('project_id is required');
            }
            progress('Fetching product info...');
            return await client.getProductInfo(params.project_id);
            
        // Legacy tools for backward compatibility
        case 'mcp0_getUserInfo':
            progress('Fetching user info (legacy)...');
            return await client.getUserInfo();
            
        case 'mcp0_fetchPersona':
            if (!params.projectId || !params.personaId) {
                throw new Error('projectId and personaId are required');
            }
            progress('Fetching persona (legacy)...');
            return await client.getPersonaProfile(params.projectId, params.personaId);
            
        case 'mcp0_fetchElevatorPitch':
            if (!params.projectId) {
                throw new Error('projectId is required');
            }
            progress('Fetching elevator pitch (legacy)...');
            const overview = await client.getProjectOverview(params.projectId);
            return { result: overview.overview?.elevatorPitch || 'No elevator pitch available' };
            
        case 'mcp0_fetchVisionStatement':
            if (!params.projectId) {
                throw new Error('projectId is required');
            }
            progress('Fetching vision statement (legacy)...');
            const visionOverview = await client.getProjectOverview(params.projectId);
            return { result: visionOverview.overview?.visionStatement || 'No vision statement available' };
            
        case 'mcp0_fetchProductInfo':
            if (!params.projectId) {
                throw new Error('projectId is required');
            }
            progress('Fetching product info (legacy)...');
            return await client.getProductInfo(params.projectId);
            
        case 'mcp0_fetchProjectEnvironment':
            if (!params.projectId) {
                throw new Error('projectId is required');
            }
            progress('Fetching project environment (legacy)...');
            return await client.getProjectEnvironment(params.projectId);
            
        case 'mcp0_checkNdaStatus':
            progress('Checking NDA status (legacy)...');
            return await client.checkNdaStatus();
            
        // Name-based lookup tools
        case 'list_projects':
            progress('Fetching all projects...');
            return await client.getAllProjects();
            
        case 'find_project_by_name':
            if (!params.project_name) {
                throw new Error('project_name is required');
            }
            progress(`Finding project by name: ${params.project_name}...`);
            return await client.findProjectByName(params.project_name);
            
        case 'find_persona_by_name':
            if (!params.project_id || !params.persona_name) {
                throw new Error('project_id and persona_name are required');
            }
            progress(`Finding persona by name: ${params.persona_name}...`);
            const projectId = await client.resolveProjectId(params.project_id);
            return await client.findPersonaByName(projectId, params.persona_name);
            
        case 'get_user_stories_by_name':
            if (!params.project_name || !params.persona_name) {
                throw new Error('project_name and persona_name are required');
            }
            progress('Resolving project and persona names...');
            const resolvedProjectId = await client.resolveProjectId(params.project_name);
            const resolvedPersonaId = await client.resolvePersonaId(resolvedProjectId, params.persona_name);
            progress('Fetching user stories...');
            return await client.getUserStories(resolvedProjectId, resolvedPersonaId);
            
        case 'get_persona_by_name':
            if (!params.project_name || !params.persona_name) {
                throw new Error('project_name and persona_name are required');
            }
            progress('Resolving project and persona names...');
            const projectIdForPersona = await client.resolveProjectId(params.project_name);
            const personaIdForProfile = await client.resolvePersonaId(projectIdForPersona, params.persona_name);
            progress('Fetching persona profile...');
            return await client.getPersonaProfile(projectIdForPersona, personaIdForProfile);
            
        default:
            throw new Error(`Tool ${toolName} not implemented`);
    }
}

// Error handling middleware
app.use((error, req, res, next) => {
    logger.error('Unhandled error', { error: error.message, stack: error.stack });
    res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
});

// SSE endpoint for MCP communication
app.get('/sse', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Authorization'
    });

    const clientId = Date.now().toString();
    logger.info('SSE client connected', { clientId });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {},
                resources: {}
            },
            serverInfo: {
                name: 'rezoomex-mcp-server',
                version: '1.0.0'
            }
        }
    })}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
        logger.info('SSE client disconnected', { clientId });
    });

    req.on('error', (err) => {
        logger.error('SSE client error', { clientId, error: err.message });
    });
});

// POST endpoint for SSE MCP requests
app.post('/sse', async (req, res) => {
    try {
        const request = req.body;
        logger.info('Received SSE MCP request', { method: request.method, id: request.id });

        let response;

        switch (request.method) {
            case 'initialize':
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {}
                        },
                        serverInfo: {
                            name: 'rezoomex-mcp-server',
                            version: '1.0.0'
                        }
                    }
                };
                break;

            case 'tools/list':
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: mcpTools.getToolDefinitions()
                    }
                };
                break;

            case 'tools/call':
                const sessionId = req.headers['x-session-id'] || 'mcp-default';
                
                // For authentication tool, handle specially
                if (request.params.name === 'authenticate') {
                    try {
                        const { email, password } = request.params.arguments;
                        
                        if (!email || !password) {
                            throw new Error('Email and password are required');
                        }
                        
                        // Authenticate with Rezoomex API
                        const params = new URLSearchParams();
                        params.append('username', email);
                        params.append('password', password);
                        
                        const authResponse = await axios.post('https://awsapi-gateway.rezoomex.com/v1/users/auth0/token', params, {
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            }
                        });
                        
                        if (authResponse.data.access_token) {
                            // Use a consistent session ID for MCP connections
                            const mcpSessionId = 'mcp-default';
                            const client = await authManager.authenticateWithToken(authResponse.data.access_token, mcpSessionId);
                            
                            if (!client) {
                                throw new Error('Failed to authenticate with received token');
                            }
                            
                            response = {
                                jsonrpc: '2.0',
                                id: request.id,
                                result: {
                                    content: [{
                                        type: 'text',
                                        text: `Authentication successful! Session ID: ${mcpSessionId}\nUser: ${client.userInfo?.email || 'Unknown'}\nYou can now use other MCP tools.`
                                    }]
                                }
                            };
                        } else {
                            throw new Error('No access token received');
                        }
                        
                    } catch (error) {
                        response = {
                            jsonrpc: '2.0',
                            id: request.id,
                            error: {
                                code: -32603,
                                message: `Authentication failed: ${error.response?.data?.error_description || error.message}`
                            }
                        };
                    }
                    break;
                }

                // For other tools, check authentication using consistent session ID
                const client = authManager.getClient(sessionId);
                if (!client) {
                    response = {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32603,
                            message: 'Not authenticated. Please authenticate first using the "authenticate" tool with your Rezoomex email and password.'
                        }
                    };
                    break;
                }

                const result = await mcpTools.callTool(
                    request.params.name,
                    request.params.arguments,
                    client
                );

                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }]
                    }
                };
                break;

            default:
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${request.method}`
                    }
                };
        }

        res.json(response);

    } catch (error) {
        logger.error('SSE MCP request error', { error: error.message });
        res.status(500).json({
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: {
                code: -32603,
                message: error.message
            }
        });
    }
});

// MCP message handling endpoint
app.post('/mcp', async (req, res) => {
    try {
        const request = req.body;
        logger.info('Received MCP request', { method: request.method, id: request.id });

        let response;

        switch (request.method) {
            case 'initialize':
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {}
                        },
                        serverInfo: {
                            name: 'rezoomex-mcp-server',
                            version: '1.0.0'
                        }
                    }
                };
                break;

            case 'tools/list':
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: mcpTools.getToolDefinitions()
                    }
                };
                break;

            case 'tools/call':
                const sessionId = req.headers['x-session-id'];
                if (!sessionId) {
                    response = {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32603,
                            message: 'Session ID required in X-Session-ID header'
                        }
                    };
                    break;
                }

                const client = authManager.getClient(sessionId);
                if (!client) {
                    response = {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32603,
                            message: 'Not authenticated. Please authenticate first.'
                        }
                    };
                    break;
                }

                const result = await mcpTools.callTool(
                    request.params.name,
                    request.params.arguments,
                    client
                );

                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }]
                    }
                };
                break;

            default:
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${request.method}`
                    }
                };
        }

        res.json(response);

    } catch (error) {
        logger.error('MCP request error', { error: error.message });
        res.status(500).json({
            jsonrpc: '2.0',
            id: req.body?.id || null,
            error: {
                code: -32603,
                message: error.message
            }
        });
    }
});

// 404 handler (must be last)
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: 'The requested endpoint was not found'
    });
});

// Start server
app.listen(PORT, () => {
    logger.info(`Rezoomex MCP Server started on port ${PORT}`, {
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development',
        version: '1.0.0'
    });
    console.log(`🚀 Rezoomex MCP Server running on http://localhost:${PORT}`);
    console.log(`📚 MCP SSE Endpoint: http://localhost:${PORT}/sse`);
    console.log(`🔧 MCP Messages: POST http://localhost:${PORT}/mcp`);
    console.log(`🔐 Authentication: http://localhost:${PORT}`);
    console.log(`📊 Health Check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

export default app;
