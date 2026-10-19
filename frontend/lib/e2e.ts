import { previewKind } from './format';

/** Hands decrypted bytes to the browser as a download (nothing leaves the page). */
export function saveBytes(data: ArrayBuffer, name: string, mimetype: string): void {
    const url = URL.createObjectURL(new Blob([data], { type: mimetype }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface DecryptedPreview {
    kind: ReturnType<typeof previewKind>;
    /** Object URL for image / video / audio / pdf (revoke it when done). */
    url?: string;
    /** First 200 KB for text. */
    text?: string;
}

/** What the page can show of decrypted content. */
export function previewOf(data: ArrayBuffer, mimetype: string): DecryptedPreview {
    const kind = previewKind(mimetype);
    if (kind === 'text') return { kind, text: new TextDecoder().decode(data.slice(0, 200 * 1024)) };
    if (kind) return { kind, url: URL.createObjectURL(new Blob([data], { type: mimetype })) };
    return { kind: null };
}
