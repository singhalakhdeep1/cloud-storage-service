'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { previewOf, saveBytes, type DecryptedPreview } from '@/lib/e2e';
import { categoryIcon } from '@/lib/format';

/**
 * An end-to-end encrypted file (or one of its versions): the passphrase never leaves this page. The content is
 * downloaded as ciphertext and decrypted in the browser, then shown and/or saved.
 */
export default function E2EEPanel({ file, version, compact = false }: { file: FileInfo; version?: number; compact?: boolean }) {
    const [passphrase, setPassphrase] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<{ data: ArrayBuffer; mimetype: string; name: string } | null>(null);
    const [preview, setPreview] = useState<DecryptedPreview | null>(null);

    useEffect(() => () => void (preview?.url && URL.revokeObjectURL(preview.url)), [preview]);
    useEffect(() => {
        setResult(null);
        setPreview(null);
    }, [file._id, file.currentVersion, version]);

    async function decrypt(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const r = await sdk.downloadDecrypted(file._id, passphrase, { version });
            setResult(r);
            if (!compact) setPreview(previewOf(r.data, r.mimetype));
            else saveBytes(r.data, r.name, r.mimetype);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3" data-testid="e2ee-panel">
            {!compact && (
                <p className="text-sm text-emerald-900">
                    🔐 <strong>End-to-end encrypted.</strong> The server only has scrambled bytes; enter the passphrase to open it here. Without the passphrase nobody, including the administrators, can read this file.
                </p>
            )}
            {!result || compact ? (
                <form className="flex flex-wrap gap-2" onSubmit={(e) => void decrypt(e)}>
                    <input className="input min-w-0 flex-1" type="password" autoComplete="off" placeholder="Passphrase" aria-label="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required />
                    <button className="btn btn-primary" disabled={busy}>{busy ? 'Decrypting…' : compact ? 'Decrypt & save' : 'Decrypt'}</button>
                </form>
            ) : (
                <div className="space-y-2">
                    {preview?.kind === 'image' && preview.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview.url} alt={result.name} className="mx-auto max-h-80 rounded object-contain" data-testid="e2ee-preview" />
                    )}
                    {preview?.kind === 'video' && preview.url && <video src={preview.url} controls className="mx-auto max-h-80 w-full" />}
                    {preview?.kind === 'audio' && preview.url && <audio src={preview.url} controls className="w-full" />}
                    {preview?.kind === 'pdf' && preview.url && <iframe src={preview.url} title={result.name} className="h-80 w-full bg-white" />}
                    {preview?.kind === 'text' && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-3 text-xs" data-testid="e2ee-preview">{preview.text}</pre>}
                    {!preview?.kind && <div className="flex h-24 items-center justify-center text-4xl" aria-hidden>{categoryIcon[file.category]}</div>}
                    <button className="btn btn-primary" onClick={() => saveBytes(result.data, result.name, result.mimetype)}>⬇️ Save decrypted file</button>
                </div>
            )}
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        </div>
    );
}
