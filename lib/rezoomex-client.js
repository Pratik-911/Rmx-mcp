import axios from 'axios';

export class RezoomexApiClient {
    constructor(bearerToken, logger) {
        this.bearerToken = bearerToken;
        this.logger = logger;
        this.baseURL = process.env.REZOOMEX_BASE_URL || 'https://awsapi-gateway.rezoomex.com';
        this.workspaceURL = process.env.REZOOMEX_LOGIN_URL || 'https://workspace.rezoomex.com';
        this.authenticated = false;
        this.userInfo = null;
        
        // Create axios instance with default config
        this.api = axios.create({
            baseURL: this.baseURL,
            timeout: parseInt(process.env.API_TIMEOUT) || 30000,
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Accept': 'application/json, text/plain, */*',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
                'Origin': this.workspaceURL,
                'Referer': `${this.workspaceURL}/`,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-site',
                'User-Agent': process.env.USER_AGENT || 'RZMX-MCP-Client/1.0'
            }
        });

        // Add response interceptor for error handling
        this.api.interceptors.response.use(
            (response) => response,
            (error) => {
                this.logger.error('API request failed', {
                    url: error.config?.url,
                    method: error.config?.method,
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data
                });
                return Promise.reject(error);
            }
        );
    }

    async makeRequest(url, method = 'GET', data = null) {
        try {
            const config = {
                method: method.toLowerCase(),
                url: url
            };
            
            if (data && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT')) {
                config.data = data;
            }
            
            return await this.api(config);
        } catch (error) {
            this.logger.error('API request failed', {
                url: url,
                method: method,
                error: error.message
            });
            throw error;
        }
    }

    async validateSession() {
        try {
            const response = await this.makeRequest('/v1/users/me');
            if (response.status === 200) {
                this.authenticated = true;
                this.userInfo = response.data;
                return true;
            }
            return false;
        } catch (error) {
            this.authenticated = false;
            return false;
        }
    }

    async checkNdaStatus() {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            // NDA status is included in user info, so get it from there
            const userInfo = await this.getUserInfo();
            return {
                success: true,
                data: {
                    ndaStatus: userInfo.data.ndaStatus || 'UNKNOWN'
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to check NDA status: ${error.message}`);
        }
    }

    async getUserInfo() {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await this.makeRequest('/v1/users/me');
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch user info: ${error.message}`);
        }
    }

    async getUserStories(projectId, personaId, pageSize = 100, startOffset = 0) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const url = `/v1/requirements/${projectId}/${personaId}/user_story`;
            const response = await this.api.get(url, {
                params: { pageSize, startOffset }
            });

            const stories = [];
            const data = response.data?.data || [];

            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                const properties = item.properties || {};
                
                const story = {
                    number: i + 1,
                    id: item.resourceId || '',
                    title: properties.goal || 'Untitled Story',
                    description: properties.description || '',
                    status: 'Active',
                    projectId,
                    personaId,
                    createdAt: item.createdAt,
                    rawData: item
                };
                stories.push(story);
            }

            // Sort by creation date for consistent ordering
            stories.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

            // Re-number after sorting
            stories.forEach((story, index) => {
                story.number = index + 1;
            });

            return {
                success: true,
                projectId,
                personaId,
                stories,
                total: stories.length,
                summary: this.formatStoriesSummary(stories),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch user stories: ${error.message}`);
        }
    }

    async getSingleStoryDetails(projectId, personaId, storyNumber = null, storyId = null) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            let story = null;

            if (storyId) {
                // Direct fetch by story ID
                const url = `/v1/requirements/${projectId}/${personaId}/user_story/${storyId}`;
                const response = await this.api.get(url);
                story = this.formatSingleStory(response.data, projectId, personaId, 1);
            } else if (storyNumber) {
                // Fetch all stories and get by number
                const storiesResult = await this.getUserStories(projectId, personaId);
                const targetStory = storiesResult.stories.find(s => s.number === storyNumber);
                
                if (!targetStory) {
                    throw new Error(`Story #${storyNumber} not found`);
                }
                
                story = targetStory;
            } else {
                throw new Error('Either storyNumber or storyId must be provided');
            }

            // Fetch additional details
            const [acceptanceCriteria, testCases, testData] = await Promise.allSettled([
                this.getStoryAcceptanceCriteria(projectId, story.id),
                this.getStoryTestCases(projectId, story.id),
                this.getStoryTestData(projectId, story.id)
            ]);

            const storyWithDetails = {
                ...story,
                acceptanceCriteria: acceptanceCriteria.status === 'fulfilled' ? acceptanceCriteria.value : [],
                testCases: testCases.status === 'fulfilled' ? testCases.value : [],
                testData: testData.status === 'fulfilled' ? testData.value : []
            };

            return {
                success: true,
                story: storyWithDetails,
                formatted: this.formatStoryDetails(storyWithDetails),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch story details: ${error.message}`);
        }
    }

    async getStoryRange(projectId, personaId, startNumber, endNumber) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const storiesResult = await this.getUserStories(projectId, personaId);
            const allStories = storiesResult.stories;

            const startIdx = Math.max(0, startNumber - 1);
            const endIdx = Math.min(allStories.length, endNumber);

            if (startIdx >= allStories.length) {
                return {
                    success: true,
                    stories: [],
                    range: `${startNumber}-${endNumber}`,
                    message: 'No stories found in the specified range',
                    timestamp: new Date().toISOString()
                };
            }

            const selectedStories = allStories.slice(startIdx, endIdx);
            const storiesWithDetails = [];

            // Fetch details for each story in parallel
            const detailPromises = selectedStories.map(async (story) => {
                try {
                    const [acceptanceCriteria, testCases, testData] = await Promise.allSettled([
                        this.getStoryAcceptanceCriteria(projectId, story.id),
                        this.getStoryTestCases(projectId, story.id),
                        this.getStoryTestData(projectId, story.id)
                    ]);

                    return {
                        ...story,
                        acceptanceCriteria: acceptanceCriteria.status === 'fulfilled' ? acceptanceCriteria.value : [],
                        testCases: testCases.status === 'fulfilled' ? testCases.value : [],
                        testData: testData.status === 'fulfilled' ? testData.value : []
                    };
                } catch (error) {
                    this.logger.warn(`Failed to fetch details for story ${story.id}`, { error: error.message });
                    return {
                        ...story,
                        acceptanceCriteria: [],
                        testCases: [],
                        testData: []
                    };
                }
            });

            const results = await Promise.all(detailPromises);
            storiesWithDetails.push(...results);

            return {
                success: true,
                stories: storiesWithDetails,
                range: `${startNumber}-${endNumber}`,
                count: storiesWithDetails.length,
                formatted: this.formatStoryRange(storiesWithDetails),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch story range: ${error.message}`);
        }
    }

    async getStoryAcceptanceCriteria(projectId, storyId) {
        try {
            const url = `/v1/requirements/${projectId}/${storyId}/acceptance_criteria`;
            const response = await this.api.get(url);
            return response.data?.data || [];
        } catch (error) {
            this.logger.warn(`Failed to fetch acceptance criteria for story ${storyId}`, { error: error.message });
            return [];
        }
    }

    async getStoryTestCases(projectId, storyId) {
        try {
            const url = `/v1/requirements/${projectId}/${storyId}/test_case`;
            const response = await this.api.get(url);
            return response.data?.data || [];
        } catch (error) {
            this.logger.warn(`Failed to fetch test cases for story ${storyId}`, { error: error.message });
            return [];
        }
    }

    async getStoryTestData(projectId, storyId) {
        try {
            const url = `/v1/requirements/${projectId}/${storyId}/test_data`;
            const response = await this.api.get(url);
            return response.data?.data || [];
        } catch (error) {
            this.logger.warn(`Failed to fetch test data for story ${storyId}`, { error: error.message });
            return [];
        }
    }

    async getProjectOverview(projectId) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const [projectDetails, elevatorPitch, visionStatement, personas] = await Promise.allSettled([
                this.getProjectDetails(projectId),
                this.getElevatorPitch(projectId),
                this.getVisionStatement(projectId),
                this.getAllPersonas(projectId)
            ]);

            const overview = {
                projectId,
                projectDetails: projectDetails.status === 'fulfilled' ? projectDetails.value : null,
                elevatorPitch: elevatorPitch.status === 'fulfilled' ? elevatorPitch.value : null,
                visionStatement: visionStatement.status === 'fulfilled' ? visionStatement.value : null,
                personas: personas.status === 'fulfilled' ? personas.value : null
            };

            return {
                success: true,
                overview,
                formatted: this.formatProjectOverview(overview),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch project overview: ${error.message}`);
        }
    }

    async getProjectDetails(projectId) {
        const url = `/v1/requirements/projects/${projectId}`;
        const response = await this.api.get(url);
        return response.data;
    }

    async getElevatorPitch(projectId) {
        const url = `/v1/requirements/${projectId}/${projectId}/elevator_pitch`;
        const response = await this.api.get(url);
        return response.data;
    }

    async getVisionStatement(projectId) {
        const url = `/v1/requirements/${projectId}/${projectId}/vision_statement`;
        const response = await this.api.get(url);
        return response.data;
    }

    async getAllPersonas(projectId) {
        const url = `/v1/requirements/${projectId}/${projectId}/persona`;
        const response = await this.api.get(url);
        return response.data;
    }

    async getPersonaProfile(projectId, personaId) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const url = `/v1/requirements/${projectId}/${projectId}/persona/${personaId}`;
            const response = await this.api.get(url);

            return {
                success: true,
                persona: response.data,
                formatted: this.formatPersonaProfile(response.data, personaId),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch persona profile: ${error.message}`);
        }
    }

    async getUserJourney(projectId, personaId, pageSize = 50, startOffset = 0) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const url = `/v1/requirements/${projectId}/${personaId}/event`;
            const response = await this.api.get(url, {
                params: { pageSize, startOffset }
            });

            const journeyData = response.data;

            return {
                success: true,
                journey: journeyData,
                formatted: this.formatUserJourney(journeyData, personaId),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch user journey: ${error.message}`);
        }
    }

    async getJobsToBeDone(projectId, personaId, pageSize = 50, startOffset = 0) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const url = `/v1/requirements/${projectId}/${personaId}/jtbd`;
            const response = await this.api.get(url, {
                params: { pageSize, startOffset }
            });

            const jtbdData = response.data;

            return {
                success: true,
                jobsToBeDone: jtbdData,
                formatted: this.formatJobsToBeDone(jtbdData, personaId),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch jobs to be done: ${error.message}`);
        }
    }

    async getProjectEnvironment(projectId) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            // Based on Python server: /v1/requirements/{product_code}/{product_code}/persona
            const response = await this.makeRequest(`/v1/requirements/${projectId}/${projectId}/persona`);
            return this.formatProjectEnvironment(response.data);
        } catch (error) {
            throw new Error(`Failed to get project environment: ${error.message}`);
        }
    }

    async getAllProjects() {
        try {
            // Based on HAR file analysis: /v1/requirements/projects endpoint doesn't exist
            // Only individual project access via /v1/requirements/projects/{projectId} works
            // So we need to test access to known project patterns
            
            const accessibleProjects = [];
            
            // Test common project ID patterns that users might have access to
            // Note: We'll try a few common patterns to enable project discovery
            // This allows name-to-ID lookup to work for accessible projects
            const commonProjectPatterns = [
                '39SQ', // Re-enable for project name lookup functionality
                // Add more patterns as discovered from user feedback or API discovery
            ];
            
            for (const projectId of commonProjectPatterns) {
                try {
                    // Test access using the individual project endpoint from HAR file
                    const response = await this.makeRequest(`/v1/requirements/projects/${projectId}`);
                    if (response.data) {
                        // Extract project data from API response
                        accessibleProjects.push({
                            id: response.data.id || projectId,
                            slug: response.data.slug || projectId,
                            name: response.data.name || response.data.title || `Project ${projectId}`,
                            description: response.data.description || response.data.elevator_pitch || 'Project description not available',
                            sponsor: response.data.sponsor || null,
                            expectedStartDate: response.data.expectedStartDate || null,
                            expectedEndDate: response.data.expectedEndDate || null,
                            companyDescription: response.data.companyDescription || null
                        });
                    }
                } catch (error) {
                    // Project not accessible or doesn't exist, skip it
                    this.logger.debug(`Project ${projectId} not accessible:`, error.message);
                }
            }
            
            if (accessibleProjects.length === 0) {
                throw new Error('No accessible projects found. Please ensure you have proper permissions or contact support to get access to projects.');
            }
            
            return {
                success: true,
                projects: accessibleProjects,
                total: accessibleProjects.length,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            this.logger.error('getAllProjects error:', error.message);
            throw new Error(`Failed to get projects list: ${error.message}`);
        }
    }

    async listProjects(page = 1, pageSize = 20) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            // Since /v1/requirements/projects endpoint doesn't exist, use getAllProjects and apply pagination
            const allProjectsResponse = await this.getAllProjects();
            const allProjects = allProjectsResponse.projects || [];
            
            // Apply pagination to the results
            const startIndex = (page - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const paginatedProjects = allProjects.slice(startIndex, endIndex);
            
            return {
                success: true,
                projects: paginatedProjects,
                total: allProjects.length,
                page: page,
                pageSize: pageSize,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('Failed to list projects with pagination', { page, pageSize, error: error.message });
            throw new Error(`Failed to list projects: ${error.message}`);
        }
    }

    async searchProjects(query, page = 1, pageSize = 20) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        if (!query || typeof query !== 'string') {
            throw new Error('Search query is required and must be a string');
        }

        try {
            // Since search endpoint doesn't exist, use client-side filtering
            const allProjects = await this.getAllProjects();
            const filteredProjects = allProjects.projects.filter(project => {
                const searchText = query.toLowerCase();
                return (
                    (project.name && project.name.toLowerCase().includes(searchText)) ||
                    (project.id && project.id.toLowerCase().includes(searchText)) ||
                    (project.description && project.description.toLowerCase().includes(searchText))
                );
            });

            // Apply pagination to filtered results
            const startIndex = (page - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            const paginatedProjects = filteredProjects.slice(startIndex, endIndex);

            return {
                success: true,
                projects: paginatedProjects,
                total: filteredProjects.length,
                query: query,
                page: page,
                pageSize: pageSize,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error('Failed to search projects', { query, page, pageSize, error: error.message });
            throw new Error(`Failed to search projects: ${error.message}`);
        }
    }

    async findProjectByName(projectName) {
        try {
            const projectsResponse = await this.getAllProjects();
            const projects = projectsResponse.projects || [];
            
            const project = projects.find(p => 
                p.name?.toLowerCase() === projectName.toLowerCase() ||
                p.id?.toLowerCase() === projectName.toLowerCase()
            );
            
            if (!project) {
                throw new Error(`Project not found: ${projectName}. Available projects: ${projects.map(p => p.name).join(', ')}`);
            }
            
            return project;
        } catch (error) {
            throw new Error(`Failed to find project by name: ${error.message}`);
        }
    }

    async findPersonaByName(projectId, personaName) {
        try {
            const envResponse = await this.getProjectEnvironment(projectId);
            const personas = envResponse.personas || [];
            const persona = personas.find(p => 
                p.name?.toLowerCase() === personaName.toLowerCase() ||
                p.id?.toLowerCase() === personaName.toLowerCase()
            );
            if (!persona) {
                throw new Error(`Persona not found with name: ${personaName}`);
            }
            return persona;
        } catch (error) {
            throw new Error(`Failed to find persona by name: ${error.message}`);
        }
    }

    async getProjectByName(projectName) {
        try {
            // Find project by name and return full project details
            const project = await this.findProjectByName(projectName);
            
            // Get full project details using the project ID
            const response = await this.makeRequest(`/v1/requirements/projects/${project.id}`);
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to get project by name: ${error.message}`);
        }
    }

    async resolveProjectId(projectNameOrId) {
        // If it looks like an ID (short alphanumeric), return as-is
        if (/^[A-Z0-9]{2,6}$/.test(projectNameOrId)) {
            return projectNameOrId;
        }
        
        // Project name to ID mappings (user-specific, should be dynamic)
        const projectMappings = {
            'talentally yours': '39SQ'
            // Note: This should ideally be fetched from user's accessible projects
            // to prevent cross-user data access
        };
        
        const normalizedName = projectNameOrId.toLowerCase();
        if (projectMappings[normalizedName]) {
            return projectMappings[normalizedName];
        }
        
        // Otherwise, try to find by name
        try {
            const project = await this.findProjectByName(projectNameOrId);
            return project.id;
        } catch (error) {
            // If not found by name, assume it's an ID anyway
            return projectNameOrId;
        }
    }

    async resolvePersonaId(projectId, personaIdentifier) {
        // If it looks like an ID (contains project prefix), use it directly
        if (personaIdentifier.includes('-P-')) {
            return personaIdentifier;
        }
        // Otherwise, treat it as a name and look it up
        const persona = await this.findPersonaByName(projectId, personaIdentifier);
        return persona.id;
    }


    async getProductInfo(projectId) {
        if (!this.authenticated) {
            throw new Error('Not authenticated');
        }

        try {
            const url = `/v1/requirements/projects/${projectId}`;
            const response = await this.api.get(url);

            return {
                success: true,
                productInfo: response.data,
                formatted: this.formatProductInfo(response.data, projectId),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Failed to fetch product info: ${error.message}`);
        }
    }

    // Formatting methods
    formatStoriesSummary(stories) {
        if (!stories || stories.length === 0) {
            return "No user stories found for this project and persona.";
        }

        const lines = [
            "📚 User Stories Summary:",
            "=" * 50
        ];

        stories.forEach(story => {
            lines.push(`${story.number}. ${story.title}`);
        });

        lines.push("=" * 50);
        lines.push(`Total: ${stories.length} user stories`);

        return lines.join('\n');
    }

    formatSingleStory(storyData, projectId, personaId, number) {
        const properties = storyData.properties || {};
        return {
            number,
            id: storyData.resourceId || '',
            title: properties.goal || 'Untitled Story',
            description: properties.description || '',
            status: 'Active',
            projectId,
            personaId,
            createdAt: storyData.createdAt,
            rawData: storyData
        };
    }

    formatStoryDetails(storyWithDetails) {
        const lines = [
            `🔢 Story #${storyWithDetails.number}: ${storyWithDetails.id}`,
            `📝 Title: ${storyWithDetails.title}`,
            `📋 Description: ${storyWithDetails.description}`
        ];

        if (storyWithDetails.acceptanceCriteria && storyWithDetails.acceptanceCriteria.length > 0) {
            lines.push('\n✅ Acceptance Criteria:');
            storyWithDetails.acceptanceCriteria.forEach((criteria, i) => {
                const props = criteria.properties || {};
                const title = props.title || `Criteria ${i + 1}`;
                lines.push(`   ${i + 1}. ${title}`);
                
                if (props.description) {
                    lines.push(`      ${props.description}`);
                }
            });
        }

        if (storyWithDetails.testCases && storyWithDetails.testCases.length > 0) {
            lines.push('\n🧪 Test Cases:');
            storyWithDetails.testCases.forEach((testCase, i) => {
                const props = testCase.properties || {};
                const title = props.title || `Test Case ${i + 1}`;
                lines.push(`   ${i + 1}. ${title}`);
                
                if (props.description) {
                    lines.push(`      ${props.description}`);
                }
            });
        }

        if (storyWithDetails.testData && storyWithDetails.testData.length > 0) {
            lines.push('\n📊 Test Data:');
            storyWithDetails.testData.forEach((testData, i) => {
                const props = testData.properties || {};
                const name = props.name || `Test Data ${i + 1}`;
                lines.push(`   ${i + 1}. ${name}`);
                
                if (props.description) {
                    lines.push(`      ${props.description}`);
                }
            });
        }

        return lines.join('\n');
    }

    formatStoryRange(storiesWithDetails) {
        if (!storiesWithDetails || storiesWithDetails.length === 0) {
            return "No stories found in the specified range.";
        }

        const lines = [
            `📚 User Stories ${storiesWithDetails[0].number}-${storiesWithDetails[storiesWithDetails.length - 1].number}:`,
            "=" * 60
        ];

        storiesWithDetails.forEach(story => {
            lines.push(this.formatStoryDetails(story));
            lines.push("-" * 60);
        });

        return lines.join('\n');
    }

    formatProjectOverview(overview) {
        const lines = ["🏢 PROJECT OVERVIEW", "=" * 60];

        lines.push(`📋 Project ID: ${overview.projectId}`);

        if (overview.projectDetails?.data?.properties) {
            const props = overview.projectDetails.data.properties;
            if (props.name) lines.push(`📝 Name: ${props.name}`);
            if (props.description) lines.push(`📄 Description: ${props.description}`);
        }

        // Elevator Pitch
        lines.push('\n🚀 ELEVATOR PITCH:');
        if (overview.elevatorPitch?.data) {
            const pitchData = Array.isArray(overview.elevatorPitch.data) 
                ? overview.elevatorPitch.data[0] 
                : overview.elevatorPitch.data;
            
            if (pitchData?.properties) {
                const props = pitchData.properties;
                const pitchParts = [];
                
                ['FOR', 'THE', 'WHO', 'IS_A', 'THAT', 'UNLIKE', 'OUR_PRODUCT'].forEach(key => {
                    if (props[key]) pitchParts.push(props[key]);
                });

                if (pitchParts.length > 0) {
                    const fullPitch = `For ${props.FOR || ''}, ${props.THE || ''} is a ${props.IS_A || ''} that ${props.THAT || ''}. Unlike ${props.UNLIKE || ''}, our product ${props.OUR_PRODUCT || ''}`;
                    lines.push(`   ${fullPitch}`);
                } else {
                    lines.push('   No elevator pitch content available');
                }
            }
        } else {
            lines.push('   No elevator pitch available');
        }

        // Vision Statement
        lines.push('\n🎯 VISION STATEMENT:');
        if (overview.visionStatement?.data?.properties?.content) {
            lines.push(`   ${overview.visionStatement.data.properties.content}`);
        } else {
            lines.push('   No vision statement available');
        }

        // Personas
        lines.push('\n👥 PERSONAS:');
        if (overview.personas?.data && Array.isArray(overview.personas.data)) {
            overview.personas.data.forEach((persona, i) => {
                const props = persona.properties || {};
                const name = props.name || `Persona ${i + 1}`;
                const personaId = persona.resourceId || 'Unknown ID';
                lines.push(`   ${i + 1}. ${name} (${personaId})`);
            });
        } else {
            lines.push('   No personas available');
        }

        lines.push("=" * 60);
        return lines.join('\n');
    }

    formatPersonaProfile(personaData, personaId) {
        const lines = [`👤 PERSONA PROFILE: ${personaId}`, "=" * 60];

        const props = personaData.properties || {};

        // Basic Info
        if (props.name) lines.push(`📝 Name: ${props.name}`);
        if (props.role) lines.push(`👔 Role: ${props.role}`);
        if (props.age) lines.push(`🎂 Age: ${props.age}`);
        if (props.gender) lines.push(`👤 Gender: ${props.gender}`);
        if (props.occupation) lines.push(`💼 Occupation: ${props.occupation}`);
        if (props.location) lines.push(`📍 Location: ${props.location}`);
        if (props.education) lines.push(`🎓 Education: ${props.education}`);
        if (props.experience) lines.push(`⏱️ Experience: ${props.experience}`);

        // Background & Traits
        if (props.background) {
            lines.push(`\n📖 Background:\n   ${props.background}`);
        }

        if (props.keyTraits) {
            const traits = Array.isArray(props.keyTraits) ? props.keyTraits.join(', ') : props.keyTraits;
            lines.push(`\n✨ Key Traits: ${traits}`);
        }

        // Goals & Motivations
        if (props.motivations) {
            lines.push('\n💡 Motivations:');
            if (Array.isArray(props.motivations)) {
                props.motivations.forEach((motivation, i) => {
                    lines.push(`   ${i + 1}. ${motivation}`);
                });
            } else {
                lines.push(`   ${props.motivations}`);
            }
        }

        lines.push("=" * 60);
        return lines.join('\n');
    }

    formatUserJourney(journeyData, personaId) {
        const lines = [`🗺️ USER JOURNEY: ${personaId}`, "=" * 60];

        if (journeyData?.data && Array.isArray(journeyData.data)) {
            journeyData.data.forEach((event, i) => {
                const props = event.properties || {};
                const eventName = props.name || `Event ${i + 1}`;
                lines.push(`\n${i + 1}. 📍 ${eventName}`);
                
                if (props.description) lines.push(`   📝 ${props.description}`);
                if (props.trigger) lines.push(`   🔥 Trigger: ${props.trigger}`);
                if (props.actions) lines.push(`   ⚡ Actions: ${props.actions}`);
                if (props.emotions) lines.push(`   😊 Emotions: ${props.emotions}`);
                if (props.pain_points) lines.push(`   😣 Pain Points: ${props.pain_points}`);
                if (props.touchpoints) lines.push(`   🤝 Touchpoints: ${props.touchpoints}`);
                if (props.opportunities) lines.push(`   💡 Opportunities: ${props.opportunities}`);
            });
        } else {
            lines.push('   No journey events found');
        }

        lines.push("=" * 60);
        return lines.join('\n');
    }

    formatJobsToBeDone(jtbdData, personaId) {
        const lines = [`🎯 JOBS TO BE DONE: ${personaId}`, "=" * 60];

        if (jtbdData?.data && Array.isArray(jtbdData.data)) {
            jtbdData.data.forEach((job, i) => {
                const props = job.properties || {};
                const jobItem = props.jtbdItem || `Job ${i + 1}`;
                lines.push(`\n${i + 1}. 🎯 ${jobItem}`);
                
                if (props.task) lines.push(`   📋 Task: ${props.task}`);
                if (props.action) lines.push(`   🎬 Action: ${props.action}`);
                if (props.description) lines.push(`   📝 Description: ${props.description}`);
                if (props.functional_job) lines.push(`   ⚙️ Functional: ${props.functional_job}`);
                if (props.emotional_job) lines.push(`   💝 Emotional: ${props.emotional_job}`);
                if (props.social_job) lines.push(`   👥 Social: ${props.social_job}`);
                if (props.context) lines.push(`   🌍 Context: ${props.context}`);
                if (props.success_criteria) lines.push(`   ✅ Success Criteria: ${props.success_criteria}`);
                if (props.obstacles) lines.push(`   🚧 Obstacles: ${props.obstacles}`);
                if (props.current_solutions) lines.push(`   🔧 Current Solutions: ${props.current_solutions}`);
            });
        } else {
            lines.push('   No jobs found');
        }

        lines.push("=" * 60);
        return lines.join('\n');
    }

    formatProjectEnvironment(data) {
        if (!data) return { environment: 'No environment data available' };
        
        // Enhanced formatting to show persona names
        const personas = data.personas || [];
        const personaList = personas.map(p => `${p.name || p.id} (${p.id})`).join(', ');
        
        return {
            environment: data,
            personas: personas,
            summary: `Project environment with ${personas.length} personas: ${personaList || 'None'}`
        };
    }

    formatProductInfo(productData, projectId) {
        const lines = [`📦 PRODUCT INFO: ${projectId}`, "=" * 60];

        if (productData?.data) {
            const data = Array.isArray(productData.data) ? productData.data[0] : productData.data;
            const props = data?.properties || {};
            
            if (props.name) lines.push(`📝 Name: ${props.name}`);
            if (props.description) lines.push(`📄 Description: ${props.description}`);
            if (props.version) lines.push(`🔢 Version: ${props.version}`);
            if (props.status) lines.push(`📊 Status: ${props.status}`);
            if (data.createdAt) lines.push(`📅 Created: ${new Date(data.createdAt).toLocaleDateString()}`);
            if (data.updatedAt) lines.push(`🔄 Updated: ${new Date(data.updatedAt).toLocaleDateString()}`);
        } else {
            lines.push('   No product information available');
        }

        lines.push("=" * 60);
        return lines.join('\n');
    }
}
