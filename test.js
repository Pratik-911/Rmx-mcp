#!/usr/bin/env node

import { RezoomexApiClient } from './lib/rezoomex-client.js';
import { AuthManager } from './lib/auth-manager.js';
import { MCPTools } from './lib/mcp-tools.js';
import { createLogger, format, transports } from 'winston';

// Create test logger
const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.colorize(),
        format.simple()
    ),
    transports: [
        new transports.Console()
    ]
});

async function runTests() {
    console.log('🧪 Running Rezoomex MCP Server Tests\n');

    // Test 1: MCP Tools initialization
    console.log('1. Testing MCP Tools initialization...');
    try {
        const mcpTools = new MCPTools();
        const tools = mcpTools.getToolDefinitions();
        console.log(`✅ MCP Tools initialized with ${tools.length} tools`);
        
        // List all tools
        tools.forEach(tool => {
            console.log(`   - ${tool.name}: ${tool.description}`);
        });
    } catch (error) {
        console.error('❌ MCP Tools test failed:', error.message);
        return;
    }

    // Test 2: Auth Manager initialization
    console.log('\n2. Testing Auth Manager initialization...');
    try {
        const authManager = new AuthManager(logger);
        console.log('✅ Auth Manager initialized successfully');
        console.log(`   - Session count: ${authManager.getSessionCount()}`);
    } catch (error) {
        console.error('❌ Auth Manager test failed:', error.message);
        return;
    }

    // Test 3: Tool validation
    console.log('\n3. Testing tool input validation...');
    try {
        const mcpTools = new MCPTools();
        
        // Test valid input
        mcpTools.validateToolInput('list_user_stories', {
            project_id: '39SQ',
            persona_id: '39SQ-P-003'
        });
        console.log('✅ Valid input validation passed');
        
        // Test invalid input
        try {
            mcpTools.validateToolInput('get_story_range', {
                start_number: 'invalid',
                end_number: 5
            });
            console.error('❌ Should have failed validation');
        } catch (validationError) {
            console.log('✅ Invalid input validation correctly failed');
        }
        
    } catch (error) {
        console.error('❌ Tool validation test failed:', error.message);
        return;
    }

    // Test 4: Mock API client (without authentication)
    console.log('\n4. Testing API client structure...');
    try {
        // This will fail authentication but we can test the structure
        const client = new RezoomexApiClient('mock-token', logger);
        console.log('✅ API client created successfully');
        console.log('   - Base URL:', client.baseURL);
        console.log('   - Authenticated:', client.authenticated);
    } catch (error) {
        console.error('❌ API client test failed:', error.message);
        return;
    }

    console.log('\n🎉 All basic tests passed!');
    console.log('\n📋 Next steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Copy .env.example to .env and configure');
    console.log('3. Start server: npm start');
    console.log('4. Test authentication with real bearer token');
    console.log('5. Test API endpoints with authenticated session');
}

// Run tests
runTests().catch(error => {
    console.error('💥 Test suite failed:', error);
    process.exit(1);
});
