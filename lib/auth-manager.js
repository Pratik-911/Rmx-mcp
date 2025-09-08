export class AuthManager {
    constructor(logger) {
        this.logger = logger;
        this.sessions = new Map();
        this.clients = new Map();
        this.tempTokens = new Map(); // For OAuth flow
        this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT) || 86400000; // 24 hours default
        this.tempTokenTimeout = parseInt(process.env.TEMP_TOKEN_TIMEOUT) || 300000; // 5 minutes default
        
        // Clean up expired sessions every hour
        setInterval(() => this.cleanupExpiredSessions(), 60 * 60 * 1000);
        // Clean up expired temp tokens every minute
        setInterval(() => this.cleanupExpiredTempTokens(), 60 * 1000);
    }

    async authenticateWithToken(bearerToken, sessionId) {
        try {
            // Import here to avoid circular dependency
            const { RezoomexApiClient } = await import('./rezoomex-client.js');
            
            const client = new RezoomexApiClient(bearerToken, this.logger);
            
            // Test authentication
            const isValid = await client.validateSession();
            
            if (isValid) {
                this.clients.set(sessionId, client);
                this.sessions.set(sessionId, { createdAt: Date.now() });
                
                this.logger.info('Client authenticated successfully', { 
                    sessionId,
                    userInfo: client.userInfo?.email || 'unknown'
                });
                
                return client;
            } else {
                this.logger.warn('Authentication failed - invalid token', { sessionId });
                return null;
            }
        } catch (error) {
            this.logger.error('Authentication error', { 
                sessionId, 
                error: error.message,
                stack: error.stack 
            });
            return null;
        }
    }

    getClient(sessionId) {
        if (!sessionId) {
            this.logger.warn('No session ID provided');
            return null;
        }

        const client = this.clients.get(sessionId);
        if (!client) {
            this.logger.warn('Client not found for session', { sessionId });
            return null;
        }

        // Refresh session timeout
        this.sessions.set(sessionId, { createdAt: Date.now() });
        return client;
    }

    clearSession(sessionId) {
        if (this.clients.has(sessionId)) {
            this.clients.delete(sessionId);
            this.logger.info('Session cleared', { sessionId });
        }

        if (this.sessions.has(sessionId)) {
            this.sessions.delete(sessionId);
        }
    }

    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.createdAt > this.sessionTimeout) {
                this.sessions.delete(sessionId);
                this.clients.delete(sessionId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            this.logger.info(`Cleaned up ${cleanedCount} expired sessions`);
        }
    }
    
    cleanupExpiredTempTokens() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [tokenId, tokenData] of this.tempTokens.entries()) {
            if (now - tokenData.createdAt > this.tempTokenTimeout) {
                this.tempTokens.delete(tokenId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            this.logger.info(`Cleaned up ${cleanedCount} expired temp tokens`);
        }
    }
    
    // Temporary token management for OAuth flow
    storeTempToken(tokenId, bearerToken) {
        this.tempTokens.set(tokenId, {
            token: bearerToken,
            createdAt: Date.now()
        });
        this.logger.info('Temporary token stored', { tokenId });
    }
    
    getTempToken(tokenId) {
        const tokenData = this.tempTokens.get(tokenId);
        if (!tokenData) {
            return null;
        }
        
        // Check if expired
        if (Date.now() - tokenData.createdAt > this.tempTokenTimeout) {
            this.tempTokens.delete(tokenId);
            return null;
        }
        
        return tokenData.token;
    }
    
    removeTempToken(tokenId) {
        const removed = this.tempTokens.delete(tokenId);
        if (removed) {
            this.logger.info('Temporary token removed', { tokenId });
        }
        return removed;
    }

    getAllSessions() {
        return Array.from(this.clients.keys());
    }

    getSessionCount() {
        return this.sessions.size;
    }
    
    getTempTokenCount() {
        return this.tempTokens.size;
    }

    async validateAllSessions() {
        const sessions = Array.from(this.clients.entries());
        const results = [];

        for (const [sessionId, client] of sessions) {
            try {
                const isValid = await client.validateSession();
                if (!isValid) {
                    this.clearSession(sessionId);
                    results.push({ sessionId, valid: false, action: 'cleared' });
                } else {
                    results.push({ sessionId, valid: true, action: 'kept' });
                }
            } catch (error) {
                this.logger.error('Session validation error', { 
                    sessionId, 
                    error: error.message 
                });
                this.clearSession(sessionId);
                results.push({ sessionId, valid: false, action: 'cleared', error: error.message });
            }
        }

        return results;
    }

    // Cleanup method for graceful shutdown
    cleanup() {
        this.logger.info('Cleaning up auth manager', { 
            sessionCount: this.clients.size,
            tempTokenCount: this.tempTokens.size 
        });

        // Clear all sessions and temp tokens
        this.clients.clear();
        this.sessions.clear();
        this.tempTokens.clear();
    }
}
