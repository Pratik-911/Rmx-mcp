export class MCPTools {
    constructor() {
        this.tools = new Map();
        this.initializeTools();
    }

    initializeTools() {
        const toolDefinitions = [
            {
                name: "authenticate",
                description: "Authenticate with Rezoomex using email and password",
                inputSchema: {
                    type: "object",
                    properties: {
                        email: { 
                            type: "string", 
                            description: "Rezoomex email address" 
                        },
                        password: { 
                            type: "string", 
                            description: "Rezoomex password" 
                        }
                    },
                    required: ["email", "password"]
                }
            },
            {
                name: "list_user_stories",
                description: "List all user stories with numbers for a project and persona",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        persona_id: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["project_id", "persona_id"]
                }
            },
            {
                name: "get_story_range",
                description: "Get user stories in a range (e.g., stories 1-5) with all details",
                inputSchema: {
                    type: "object",
                    properties: {
                        start_number: { 
                            type: "integer", 
                            description: "Start story number (1-based)", 
                            minimum: 1 
                        },
                        end_number: { 
                            type: "integer", 
                            description: "End story number (1-based)", 
                            minimum: 1 
                        },
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        persona_id: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["start_number", "end_number", "project_id", "persona_id"]
                }
            },
            {
                name: "get_single_story_details",
                description: "Get detailed information for a single user story by number or ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        story_number: { 
                            type: "integer", 
                            description: "Story number (1-based)", 
                            minimum: 1 
                        },
                        story_id: { 
                            type: "string", 
                            description: "Story ID (e.g., 39SQ-P-003-001)" 
                        },
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        persona_id: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["project_id", "persona_id"]
                }
            },
            {
                name: "get_project_overview",
                description: "Get comprehensive project overview with elevator pitch, vision, and personas",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["project_id"]
                }
            },
            {
                name: "get_persona_profile",
                description: "Get detailed persona profile with demographics, goals, and characteristics",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        persona_id: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["project_id", "persona_id"]
                }
            },
            {
                name: "get_user_journey",
                description: "Get detailed user journey events and touchpoints for a persona",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        persona_id: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["project_id", "persona_id"]
                }
            },
            {
                name: "get_jobs_to_be_done",
                description: "Get Jobs to be Done analysis for a persona with functional, emotional, and social jobs",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        persona_id: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["project_id", "persona_id"]
                }
            },
            {
                name: "get_user_info",
                description: "Get authenticated user profile information",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "get_project_environment",
                description: "Get project environment information including personas",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["project_id"]
                }
            },
            {
                name: "check_nda_status",
                description: "Check NDA status for the authenticated user",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "get_product_info",
                description: "Get detailed product information for a project",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["project_id"]
                }
            },
            {
                name: "list_projects",
                description: "List all available projects with their names and IDs",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "find_project_by_name",
                description: "Find a project by its name and get the project ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_name: {
                            type: "string",
                            description: "Project name to search for"
                        }
                    },
                    required: ["project_name"]
                }
            },
            {
                name: "find_persona_by_name",
                description: "Find a persona by name within a project and get the persona ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_id: {
                            type: "string",
                            description: "Project ID or name"
                        },
                        persona_name: {
                            type: "string",
                            description: "Persona name to search for"
                        }
                    },
                    required: ["project_id", "persona_name"]
                }
            },
            {
                name: "get_user_stories_by_name",
                description: "List user stories using project and persona names (more user-friendly)",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_name: {
                            type: "string",
                            description: "Project name or ID"
                        },
                        persona_name: {
                            type: "string",
                            description: "Persona name or ID"
                        }
                    },
                    required: ["project_name", "persona_name"]
                }
            },
            {
                name: "get_persona_by_name",
                description: "Get persona profile using project and persona names (user-friendly)",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_name: { 
                            type: "string", 
                            description: "Project name or ID" 
                        },
                        persona_name: { 
                            type: "string", 
                            description: "Persona name or ID" 
                        }
                    },
                    required: ["project_name", "persona_name"]
                }
            },
            {
                name: "get_project_by_name",
                description: "Find and get project details by name",
                inputSchema: {
                    type: "object",
                    properties: {
                        project_name: { 
                            type: "string", 
                            description: "Project name to search for (e.g., 'Talentally Yours')" 
                        }
                    },
                    required: ["project_name"]
                }
            },
            {
                name: "mcp0_getUserInfo",
                description: "Legacy: Get authenticated user profile information",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                name: "mcp0_fetchPersona",
                description: "Legacy: Get persona details by project and persona ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        projectId: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        },
                        personaId: { 
                            type: "string", 
                            description: "Persona ID (required)" 
                        }
                    },
                    required: ["projectId", "personaId"]
                }
            },
            {
                name: "mcp0_fetchElevatorPitch",
                description: "Legacy: Get project elevator pitch",
                inputSchema: {
                    type: "object",
                    properties: {
                        projectId: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["projectId"]
                }
            },
            {
                name: "mcp0_fetchVisionStatement",
                description: "Legacy: Get project vision statement",
                inputSchema: {
                    type: "object",
                    properties: {
                        projectId: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["projectId"]
                }
            },
            {
                name: "mcp0_fetchProductInfo",
                description: "Legacy: Get product information",
                inputSchema: {
                    type: "object",
                    properties: {
                        projectId: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["projectId"]
                }
            },
            {
                name: "mcp0_fetchProjectEnvironment",
                description: "Legacy: Get project environment information",
                inputSchema: {
                    type: "object",
                    properties: {
                        projectId: { 
                            type: "string", 
                            description: "Project ID (required)" 
                        }
                    },
                    required: ["projectId"]
                }
            },
            {
                name: "mcp0_checkNdaStatus",
                description: "Legacy: Check NDA status for the authenticated user",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        ];

        // Store tools in map for quick lookup
        toolDefinitions.forEach(tool => {
            this.tools.set(tool.name, tool);
        });
    }

    getToolDefinitions() {
        return Array.from(this.tools.values());
    }

    getTool(name) {
        return this.tools.get(name);
    }

    hasTools(name) {
        return this.tools.has(name);
    }

    validateToolInput(toolName, input) {
        const tool = this.getTool(toolName);
        if (!tool) {
            throw new Error(`Unknown tool: ${toolName}`);
        }

        const schema = tool.inputSchema;
        const errors = [];

        // Check required fields
        if (schema.required && schema.required.length > 0) {
            for (const requiredField of schema.required) {
                if (!(requiredField in input) || input[requiredField] === null || input[requiredField] === undefined) {
                    errors.push(`Missing required field: ${requiredField}`);
                }
            }
        }

        // Validate field types and constraints
        if (schema.properties) {
            for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
                if (fieldName in input) {
                    const value = input[fieldName];
                    
                    // Type validation
                    if (fieldSchema.type === 'integer' && !Number.isInteger(value)) {
                        errors.push(`Field ${fieldName} must be an integer`);
                    } else if (fieldSchema.type === 'string' && typeof value !== 'string') {
                        errors.push(`Field ${fieldName} must be a string`);
                    }
                    
                    // Constraint validation
                    if (fieldSchema.minimum !== undefined && value < fieldSchema.minimum) {
                        errors.push(`Field ${fieldName} must be at least ${fieldSchema.minimum}`);
                    }
                    
                    if (fieldSchema.maximum !== undefined && value > fieldSchema.maximum) {
                        errors.push(`Field ${fieldName} must be at most ${fieldSchema.maximum}`);
                    }
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Validation errors: ${errors.join(', ')}`);
        }

        return true;
    }

    async callTool(toolName, args, client) {
        // Validate tool exists
        if (!this.hasTools(toolName)) {
            throw new Error(`Unknown tool: ${toolName}`);
        }

        // Validate input
        this.validateToolInput(toolName, args);

        // Handle authentication tool specially (doesn't need client)
        if (toolName === 'authenticate') {
            throw new Error('Authentication should be handled by the server directly');
        }

        // All other tools require an authenticated client
        if (!client) {
            throw new Error('Client is required for this tool');
        }

        // Call the appropriate client method based on tool name
        switch (toolName) {
            case 'list_user_stories':
                return await client.getUserStories(args.project_id, args.persona_id);
            
            case 'get_story_range':
                return await client.getStoryRange(
                    args.project_id,
                    args.persona_id,
                    args.start_number,
                    args.end_number
                );
            
            case 'get_single_story_details':
                return await client.getSingleStoryDetails(
                    args.project_id,
                    args.persona_id,
                    args.story_number,
                    args.story_id
                );
            
            case 'get_project_overview':
                return await client.getProjectOverview(args.project_id);
            
            case 'get_persona_profile':
                return await client.getPersonaProfile(args.project_id, args.persona_id);
            
            case 'get_user_journey':
                return await client.getUserJourney(args.project_id, args.persona_id);
            
            case 'get_jobs_to_be_done':
                return await client.getJobsToBeDone(args.project_id, args.persona_id);
            
            case 'get_user_info':
                return await client.getUserInfo();
            
            case 'get_project_environment':
                return await client.getProjectEnvironment(args.project_id);
            
            case 'check_nda_status':
                return await client.checkNdaStatus();
            
            case 'get_product_info':
                return await client.getProductInfo(args.project_id);
            
            case 'list_projects':
                return await client.getAllProjects();
            
            case 'find_project_by_name':
                return await client.findProjectByName(args.project_name);
            
            case 'find_persona_by_name':
                const findPersonaProjectId = await client.resolveProjectId(args.project_id);
                return await client.findPersonaByName(findPersonaProjectId, args.persona_name);
            
            case 'get_user_stories_by_name':
                const storiesProjectId = await client.resolveProjectId(args.project_name);
                const personaId = await client.resolvePersonaId(storiesProjectId, args.persona_name);
                return await client.getUserStories(storiesProjectId, personaId);
            
            case 'get_project_by_name':
                return await client.findProjectByName(args.project_name);
            
            case 'get_persona_by_name':
                const projectIdForPersona = await client.resolveProjectId(args.project_name);
                const personaIdForProfile = await client.resolvePersonaId(projectIdForPersona, args.persona_name);
                return await client.getPersonaProfile(projectIdForPersona, personaIdForProfile);
            
            // Legacy tools
            case 'mcp0_getUserInfo':
                return await client.getUserInfo();
            
            case 'mcp0_fetchPersona':
                return await client.getPersonaProfile(args.projectId, args.personaId);
            
            case 'mcp0_fetchElevatorPitch':
                const overview = await client.getProjectOverview(args.projectId);
                return { result: overview.overview?.elevatorPitch || 'No elevator pitch available' };
            
            case 'mcp0_fetchVisionStatement':
                const visionOverview = await client.getProjectOverview(args.projectId);
                return { result: visionOverview.overview?.visionStatement || 'No vision statement available' };
            
            case 'mcp0_fetchProductInfo':
                return await client.getProductInfo(args.projectId);
            
            case 'mcp0_fetchProjectEnvironment':
                return await client.getProjectEnvironment(args.projectId);
            
            case 'mcp0_checkNdaStatus':
                return await client.checkNdaStatus();
            
            default:
                throw new Error(`Tool ${toolName} not implemented`);
        }
    }

    getToolUsageStats() {
        return {
            totalTools: this.tools.size,
            toolNames: Array.from(this.tools.keys())
        };
    }
}
