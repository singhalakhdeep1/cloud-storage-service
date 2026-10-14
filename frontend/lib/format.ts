export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const n = bytes / 1024 ** i;
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso?: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(iso: string): string {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
}

export const categoryIcon: Record<string, string> = { image: '🖼️', video: '🎬', audio: '🎵', document: '📄', other: '📦' };

/** Previewable in the browser. */
export function previewKind(mimetype: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | null {
    if (/^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(mimetype)) return 'image';
    if (/^video\/(mp4|webm|ogg)$/.test(mimetype)) return 'video';
    if (/^audio\/(mpeg|wav|ogg|webm|mp4)$/.test(mimetype)) return 'audio';
    if (mimetype === 'application/pdf') return 'pdf';
    if (/^text\/(plain|csv|markdown)$/.test(mimetype) || mimetype === 'application/json') return 'text';
    return null;
}

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
