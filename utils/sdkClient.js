const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * CURRICULUM COVERAGE:
 * #1826-1850: Third-party integration SDK library
 */
class FileCloudSDK {
    constructor(config = {}) {
        this.apiUrl = config.apiUrl || 'http://localhost:5000/api';
        this.token = config.token || null;
    }

    _request(method, path, data = null, headers = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(`${this.apiUrl}${path}`);
            const lib = url.protocol === 'https:' ? https : http;

            const options = {
                method: method,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                headers: {
                    'Accept': 'application/json',
                    ...headers
                }
            };

            if (this.token) {
                options.headers['Authorization'] = `Bearer ${this.token}`;
            }

            const req = lib.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        if (res.statusCode >= 400) {
                            reject(new Error(parsed.error || `Request failed with status ${res.statusCode}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                });
            });

            req.on('error', (err) => reject(err));

            if (data) {
                if (headers['Content-Type'] && headers['Content-Type'].startsWith('multipart/form-data')) {
                    req.write(data);
                } else {
                    req.write(JSON.stringify(data));
                }
            }
            req.end();
        });
    }

    async getFile(id) {
        return this._request('GET', `/files/${id}`);
    }

    async downloadFile(id) {
        return this._request('GET', `/files/${id}/download`);
    }

    async deleteFile(id) {
        return this._request('DELETE', `/files/${id}`);
    }

    async getStats() {
        return this._request('GET', '/files/stats');
    }

    async getPresignedUploadUrl(filename, contentType) {
        return this._request('POST', '/files/presigned-url', { filename, contentType }, {
            'Content-Type': 'application/json'
        });
    }

    async uploadFile(fileBuffer, filename, mimetype, isPublic = false) {
        const boundary = '----FileCloudSDKBoundary' + Math.random().toString(16).substring(2);
        
        let payload = `--${boundary}\r\n`;
        payload += `Content-Disposition: form-data; name="isPublic"\r\n\r\n`;
        payload += `${isPublic}\r\n`;
        payload += `--${boundary}\r\n`;
        payload += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
        payload += `Content-Type: ${mimetype}\r\n\r\n`;

        const headerBuffer = Buffer.from(payload, 'utf8');
        const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const bodyBuffer = Buffer.concat([headerBuffer, fileBuffer, footerBuffer]);

        return this._request('POST', '/files/upload', bodyBuffer, {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuffer.length
        });
    }
}

module.exports = FileCloudSDK;
