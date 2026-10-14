/**
 * Virus scanning with ClamAV. Talks to a clamd daemon over TCP with the INSTREAM command, so files are streamed
 * to the scanner (nothing is held in memory) and no ClamAV binary is needed in this container.
 *
 * Policy: when scanning is enabled and the scanner cannot be reached, the upload is rejected (fail closed) unless
 * VIRUS_SCAN_FAIL_OPEN=true.
 */
import fs from 'fs';
import net from 'net';
import type { Readable } from 'stream';
import cfg from '../config/env';
import logger from '../config/logger';
import AppError from './appError';

export interface ScanResult {
    /** The file may be stored. */
    clean: boolean;
    infected: boolean;
    viruses: string[];
    /** Scanning was not performed (disabled, or the scanner was down and VIRUS_SCAN_FAIL_OPEN is on). */
    skipped: boolean;
    error?: string;
}

const CHUNK = 64 * 1024;

export class VirusScanner {
    constructor(
        private readonly host = cfg.CLAMAV_HOST,
        private readonly port = cfg.CLAMAV_PORT,
        private readonly timeoutMs = 60_000
    ) {}

    get enabled(): boolean {
        return cfg.ENABLE_VIRUS_SCAN;
    }

    /** Streams data to clamd; resolves with the daemon's one-line verdict. */
    private instream(source: Readable): Promise<string> {
        return new Promise((resolve, reject) => {
            const socket = net.connect({ host: this.host, port: this.port });
            let response = '';
            let done = false;
            const finish = (err?: Error, value?: string) => {
                if (done) return;
                done = true;
                socket.destroy();
                source.destroy();
                if (err) reject(err);
                else resolve(value as string);
            };
            socket.setTimeout(this.timeoutMs, () => finish(new Error('ClamAV timed out')));
            socket.on('error', (e) => finish(e));
            socket.on('data', (d) => (response += d.toString('utf8')));
            socket.on('end', () => finish(undefined, response.replace(/\0/g, '').trim()));
            socket.on('connect', () => {
                socket.write('zINSTREAM\0');
                source.on('data', (chunk: Buffer) => {
                    // clamd wants <4-byte big-endian length><data> frames; keep frames below its StreamMaxLength window
                    for (let i = 0; i < chunk.length; i += CHUNK) {
                        const part = chunk.subarray(i, i + CHUNK);
                        const len = Buffer.alloc(4);
                        len.writeUInt32BE(part.length);
                        if (!socket.write(Buffer.concat([len, part]))) {
                            source.pause();
                            socket.once('drain', () => source.resume());
                        }
                    }
                });
                source.on('end', () => socket.write(Buffer.alloc(4))); // zero-length frame ends the stream
                source.on('error', (e) => finish(e));
            });
        });
    }

    private interpret(verdict: string): ScanResult {
        // "stream: OK" | "stream: Eicar-Test-Signature FOUND" | "INSTREAM size limit exceeded. ERROR"
        if (/\bOK$/.test(verdict)) return { clean: true, infected: false, viruses: [], skipped: false };
        const found = /^stream:\s*(.+?)\s+FOUND$/.exec(verdict);
        if (found) return { clean: false, infected: true, viruses: [found[1] as string], skipped: false };
        throw new Error(verdict || 'Empty answer from ClamAV');
    }

    async scanStream(source: Readable): Promise<ScanResult> {
        if (!this.enabled) return { clean: true, infected: false, viruses: [], skipped: true };
        try {
            return this.interpret(await this.instream(source));
        } catch (e) {
            const message = (e as Error).message;
            logger.error('Virus scan failed', { err: message });
            if (cfg.VIRUS_SCAN_FAIL_OPEN) return { clean: true, infected: false, viruses: [], skipped: true, error: message };
            throw new AppError('The file could not be scanned for viruses right now, please try again later', 503, 'scan_unavailable');
        }
    }

    scanFile(filePath: string): Promise<ScanResult> {
        return this.scanStream(fs.createReadStream(filePath));
    }

    async scanBuffer(buffer: Buffer): Promise<ScanResult> {
        const { Readable } = await import('stream');
        return this.scanStream(Readable.from([buffer]));
    }

    /** Health: true = answers PING, false = enabled but unreachable, null = disabled. */
    async healthy(): Promise<boolean | null> {
        if (!this.enabled) return null;
        return new Promise((resolve) => {
            const socket = net.connect({ host: this.host, port: this.port });
            let out = '';
            socket.setTimeout(3000, () => {
                socket.destroy();
                resolve(false);
            });
            socket.on('error', () => resolve(false));
            socket.on('connect', () => socket.write('zPING\0'));
            socket.on('data', (d) => (out += d.toString()));
            socket.on('end', () => resolve(out.replace(/\0/g, '').trim() === 'PONG'));
        });
    }
}

const virusScanner = new VirusScanner();
export default virusScanner;
