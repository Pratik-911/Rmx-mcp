#!/usr/bin/env node

import { AuthManager } from './lib/auth-manager.js';
import { MCPTools } from './lib/mcp-tools.js';
import { createLogger, format, transports } from 'winston';
import { config } from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
config();

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
            filename: 'mcp-server.log',
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

class MCPServer {
    constructor() {
        this.authManager = new AuthManager(logger);
        this.mcpTools = new MCPTools();
        this.sessions = new Map();
        
        // Bind stdin/stdout for MCP communication
        process.stdin.setEncoding('utf8');
        process.stdout.setEncoding('utf8');
        
        // Handle MCP messages
        let buffer = '';
        process.stdin.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.trim()) {
                    this.handleMessage(line.trim());
                }
            }
        });
        
        process.stdin.on('end', () => {
            if (buffer.trim()) {
                this.handleMessage(buffer.trim());
            }
        });
    }
    
    async handleMessage(message) {
        try {
            const request = JSON.parse(message);
            logger.info('Received MCP request', { method: request.method, id: request.id });
            
            let response;
            
            switch (request.method) {
                case 'initialize':
                    response = await this.handleInitialize(request);
                    break;
                case 'tools/list':
                    response = await this.handleToolsList(request);
                    break;
                case 'tools/call':
                    response = await this.handleToolCall(request);
                    break;
                case 'auth/login':
                    response = await this.handleAuthLogin(request);
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
            
            this.sendResponse(response);
            
        } catch (error) {
            logger.error('Error handling MCP message', { error: error.message, message });
            
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: 'Parse error'
                }
            };
            
            this.sendResponse(errorResponse);
        }
    }
    
    sendResponse(response) {
        const responseStr = JSON.stringify(response);
        process.stdout.write(responseStr + '\n');
        logger.info('Sent MCP response', { method: response.method || 'response', id: response.id });
    }
    
    async handleInitialize(request) {
        return {
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
    }
    
    async handleToolsList(request) {
        const tools = [
            {
                name: 'authenticate',
                description: 'Authenticate with Rezoomex using email and password',
                inputSchema: {
                    type: 'object',
                    properties: {
                        email: { type: 'string', description: 'Rezoomex email' },
                        password: { type: 'string', description: 'Rezoomex password' }
                    },
                    required: ['email', 'password']
                }
            },
            {
                name: 'list_user_stories',
                description: 'List all user stories for a project and persona',
                inputSchema: {
                    type: 'object',
                    properties: {
                        project_id: { type: 'string', description: 'Project ID' },
                        persona_id: { type: 'string', description: 'Persona ID' }
                    },
                    required: ['project_id', 'persona_id']
                }
            },
            {
                name: 'get_user_story',
                description: 'Get specific user story details',
                inputSchema: {
                    type: 'object',
                    properties: {
                        project_id: { type: 'string', description: 'Project ID' },
                        parent_id: { type: 'string', description: 'Parent ID' },
                        story_id: { type: 'string', description: 'Story ID' }
                    },
                    required: ['project_id', 'parent_id', 'story_id']
                }
            }
        ];
        
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                tools: tools
            }
        };
    }
    
    async handleAuthLogin(request) {
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
                const sessionId = uuidv4();
                const client = await this.authManager.authenticateWithToken(authResponse.data.access_token, sessionId);
                
                if (!client) {
                    throw new Error('Failed to authenticate with received token');
                }
                
                // Store session for future tool calls
                this.sessions.set('current', { sessionId, client });
                
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        content: [{
                            type: 'text',
                            text: `Authentication successful! Session ID: ${sessionId}\nUser: ${client.userInfo?.email || 'Unknown'}`
                        }]
                    }
                };
            } else {
                throw new Error('No access token received');
            }
            
        } catch (error) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: `Authentication failed: ${error.response?.data?.error_description || error.message}`
                }
            };
        }
    }
    
    async handleToolCall(request) {
        try {
            const { name, arguments: args } = request.params;
            
            if (name === 'authenticate') {
                return await this.handleAuthLogin(request);
            }
            
            // Check if authenticated for other tools
            const session = this.sessions.get('current');
            if (!session) {
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32603,
                        message: 'Not authenticated. Please call authenticate tool first.'
                    }
                };
            }
            
            const { client } = session;
            let result;
            
            switch (name) {
                case 'list_user_stories':
                    result = await client.getUserStories(args.project_id, args.persona_id);
                    break;
                case 'get_user_story':
                    result = await client.getUserStory(args.project_id, args.parent_id, args.story_id);
                    break;
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
            
            return {
                jsonrpc: '2.0',
                id: request.id,
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(result, null, 2)
                    }]
                }
            };
            
        } catch (error) {
            logger.error('Tool call error', { tool: request.params?.name, error: error.message });
            
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: error.message
                }
            };
        }
    }
}

// Start the MCP server
const server = new MCPServer();
logger.info('Rezoomex MCP Server started');
