const NodeClam = require('clamav.js');
const logger = require('../config/logger');

class VirusScanner {
    constructor() {
        this.clam = null;
        this.enabled = process.env.ENABLE_VIRUS_SCAN === 'true';
        this.host = process.env.CLAMAV_HOST || 'localhost';
        this.port = process.env.CLAMAV_PORT || 3310;
        this.initialized = false;
    }

    // Initialize ClamAV connection
    async init() {
        if (!this.enabled) {
            logger.info('Virus scanning disabled');
            return false;
        }

        try {
            this.clam = new NodeClam().init({
                clamdscan: {
                    host: this.host,
                    port: this.port,
                    localFallback: true
                },
                preference: 'clamdscan'
            });

            const version = await this.clam.getVersion();
            logger.info(`ClamAV initialized successfully. Version: ${version}`);
            this.initialized = true;
            return true;
        } catch (error) {
            logger.error('Failed to initialize ClamAV:', error);
            this.enabled = false;
            return false;
        }
    }

    // Scan buffer
    async scanBuffer(buffer, filename = 'unknown') {
        if (!this.enabled || !this.initialized) {
            logger.warn('Virus scanning not available, skipping scan');
            return { clean: true, skipped: true };
        }

        try {
            logger.info(`Scanning file: ${filename}`);
            
            const result = await this.clam.scanBuffer(buffer, filename);
            
            if (result.isInfected) {
                logger.warn(`Virus detected in file: ${filename}`, {
                    viruses: result.viruses
                });
                return {
                    clean: false,
                    infected: true,
                    viruses: result.viruses,
                    error: null
                };
            }

            logger.info(`File clean: ${filename}`);
            return {
                clean: true,
                infected: false,
                viruses: [],
                error: null
            };
        } catch (error) {
            logger.error('Virus scan error:', error);
            return {
                clean: false,
                infected: false,
                viruses: [],
                error: error.message
            };
        }
    }

    // Scan file path
    async scanFile(filePath) {
        if (!this.enabled || !this.initialized) {
            logger.warn('Virus scanning not available, skipping scan');
            return { clean: true, skipped: true };
        }

        try {
            logger.info(`Scanning file path: ${filePath}`);
            
            const result = await this.clam.scanFile(filePath);
            
            if (result.isInfected) {
                logger.warn(`Virus detected in file: ${filePath}`, {
                    viruses: result.viruses
                });
                return {
                    clean: false,
                    infected: true,
                    viruses: result.viruses,
                    error: null
                };
            }

            logger.info(`File clean: ${filePath}`);
            return {
                clean: true,
                infected: false,
                viruses: [],
                error: null
            };
        } catch (error) {
            logger.error('Virus scan error:', error);
            return {
                clean: false,
                infected: false,
                viruses: [],
                error: error.message
            };
        }
    }

    // Check if scanner is ready
    isReady() {
        return this.enabled && this.initialized;
    }

    // Get scanner status
    getStatus() {
        return {
            enabled: this.enabled,
            initialized: this.initialized,
            host: this.host,
            port: this.port
        };
    }
}

// Create singleton instance
const virusScanner = new VirusScanner();

// Initialize on module load
virusScanner.init().catch(error => {
    logger.error('Failed to initialize virus scanner:', error);
});

module.exports = virusScanner;
