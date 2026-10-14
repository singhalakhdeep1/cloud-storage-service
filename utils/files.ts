import path from 'path';
import type { FileCategory } from '../types/models';

/** A file name that is safe to store, log and put in a header: no path parts, control characters or odd separators. */
export function sanitizeFilename(name: string, fallback = 'file'): string {
    // multer decodes multipart names as latin1; browsers send UTF-8, so repair the common mojibake
    let n = name;
    if (/[Â-ô][\u0080-¿]/.test(n)) {
        try {
            const fixed = Buffer.from(n, 'latin1').toString('utf8');
            if (!fixed.includes('�')) n = fixed;
        } catch {
            /* keep as is */
        }
    }
    n = path.basename(n.replace(/\\/g, '/')).normalize('NFC');
    // eslint-disable-next-line no-control-regex
    n = n.replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    if (n.length > 200) {
        const ext = path.extname(n).slice(0, 20);
        n = n.slice(0, 200 - ext.length) + ext;
    }
    return n || fallback;
}

/** Characters allowed in an object key segment (the original name is kept in the database, not trusted in keys). */
export function keySafe(name: string): string {
    const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    return ext;
}

export function categoryFromMimetype(mimetype: string): FileCategory {
    const m = mimetype.toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (
        m === 'application/pdf' ||
        m === 'application/msword' ||
        m === 'application/rtf' ||
        m.startsWith('application/vnd.ms-') ||
        m.startsWith('application/vnd.openxmlformats-officedocument') ||
        m.startsWith('application/vnd.oasis.opendocument') ||
        m.startsWith('text/')
    )
        return 'document';
    return 'other';
}

/** Types a browser may render inline. Everything else (HTML, SVG, scripts, unknown) is always an attachment. */
const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|wav|ogg|webm|mp4)|application\/pdf|text\/plain)$/i;
export const isInlineSafe = (mimetype: string): boolean => INLINE_SAFE.test(mimetype);

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = bytes / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

/** Parses an HTTP Range header for a single range. Returns null when absent, 'invalid' when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m) return null; // ignore multi-range and unknown units: serve the whole object
    const [, a, b] = m;
    let start: number;
    let end: number;
    if (a === '' && b === '') return 'invalid';
    if (a === '') {
        const suffix = Number(b);
        if (suffix === 0) return 'invalid';
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(a);
        end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
    }
    if (start >= size || start > end) return 'invalid';
    return { start, end };
}
