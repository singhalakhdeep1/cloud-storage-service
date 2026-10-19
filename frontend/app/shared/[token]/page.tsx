'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage, FileCloudError, sdk } from '@/lib/api';
import { previewOf, saveBytes, type DecryptedPreview } from '@/lib/e2e';
import { categoryIcon, formatBytes, formatDateTime, previewKind } from '@/lib/format';
import { Spinner } from '@/components/ui';

type Info = Awaited<ReturnType<typeof sdk.describeLink>>;

/** The page a share link opens: no account needed. */
export default function SharedFilePage() {
    const { token } = useParams<{ token: string }>();
    const [info, setInfo] = useState<Info | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [passphrase, setPassphrase] = useState('');
    const [decrypted, setDecrypted] = useState<{ data: ArrayBuffer; mimetype: string; name: string } | null>(null);
    const [e2ePreview, setE2ePreview] = useState<DecryptedPreview | null>(null);

    useEffect(() => () => void (e2ePreview?.url && URL.revokeObjectURL(e2ePreview.url)), [e2ePreview]);

    useEffect(() => {
        sdk.describeLink(token).then(setInfo, (e) => setError(e instanceof FileCloudError && e.status === 404 ? 'This link is not valid any more.' : errorMessage(e)));
    }, [token]);

    /** End-to-end encrypted file: download the ciphertext and decrypt it in this page. */
    async function openEncrypted(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
            const r = await sdk.openLinkDecrypted(token, passphrase, password || undefined);
            setDecrypted(r);
            setE2ePreview(previewOf(r.data, r.mimetype));
            if (info?.permission === 'download') setInfo((i) => (i && i.remainingDownloads !== undefined ? { ...i, remainingDownloads: Math.max(0, i.remainingDownloads - 1) } : i));
        } catch (err) {
            setMessage(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    async function open(e: FormEvent, inline: boolean) {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
            const r = await sdk.openLink(token, password || undefined, inline);
            if (inline) setPreview(r.url);
            else {
                const a = document.createElement('a');
                a.href = r.url;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setMessage('Your download has started.');
                setInfo((i) => (i && i.remainingDownloads !== undefined ? { ...i, remainingDownloads: Math.max(0, i.remainingDownloads - 1) } : i));
            }
        } catch (err) {
            setMessage(errorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    const ce = info?.clientEncryption;
    const kind = info && !ce ? previewKind(info.mimetype) : null;
    return (
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 to-slate-900 p-4">
            <div className="card w-full max-w-lg p-6">
                {error ? (
                    <div className="py-8 text-center"><div className="text-4xl" aria-hidden>🔗</div><p className="mt-2 text-lg font-medium" role="alert">{error}</p></div>
                ) : !info ? (
                    <Spinner />
                ) : (
                    <>
                        <div className="mb-4 flex items-center gap-3">
                            <span className="text-4xl" aria-hidden>{categoryIcon[info.category]}</span>
                            <div className="min-w-0">
                                <h1 className="truncate text-lg font-semibold" title={info.name}>{info.name}</h1>
                                <p className="text-sm text-slate-500">{formatBytes(ce?.size ?? info.size)} · {ce?.mimetype ?? info.mimetype}{info.sharedBy ? ` · shared by ${info.sharedBy}` : ''}</p>
                            </div>
                        </div>
                        {info.expiresAt && <p className="mb-2 text-xs text-slate-500">Available until {formatDateTime(info.expiresAt)}</p>}
                        {info.remainingDownloads !== undefined && <p className="mb-2 text-xs text-slate-500">{info.remainingDownloads} download{info.remainingDownloads === 1 ? '' : 's'} left</p>}

                        {preview && kind === 'image' && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={preview} alt={info.name} className="mb-4 max-h-80 w-full rounded-lg object-contain" />
                        )}
                        {preview && kind === 'video' && <video src={preview} controls className="mb-4 max-h-80 w-full rounded-lg" />}
                        {preview && kind === 'audio' && <audio src={preview} controls className="mb-4 w-full" />}
                        {preview && kind === 'pdf' && <iframe src={preview} title={info.name} className="mb-4 h-80 w-full rounded-lg" />}

                        {ce ? (
                            <form className="space-y-3" onSubmit={(e) => void openEncrypted(e)} data-testid="e2ee-link-form">
                                <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">🔐 This file is end-to-end encrypted. Ask the person who shared it for the passphrase; it is used only in this page.</p>
                                {e2ePreview?.kind === 'image' && e2ePreview.url && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={e2ePreview.url} alt={info.name} className="max-h-80 w-full rounded-lg object-contain" data-testid="e2ee-preview" />
                                )}
                                {e2ePreview?.kind === 'text' && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs" data-testid="e2ee-preview">{e2ePreview.text}</pre>}
                                {e2ePreview?.kind === 'pdf' && e2ePreview.url && <iframe src={e2ePreview.url} title={info.name} className="h-80 w-full rounded-lg" />}
                                {e2ePreview?.kind === 'video' && e2ePreview.url && <video src={e2ePreview.url} controls className="max-h-80 w-full rounded-lg" />}
                                {e2ePreview?.kind === 'audio' && e2ePreview.url && <audio src={e2ePreview.url} controls className="w-full" />}
                                {!decrypted && (
                                    <>
                                        {info.requiresPassword && <label className="block"><span className="label">Link password</span><input className="input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>}
                                        <label className="block"><span className="label">Passphrase</span><input className="input" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required /></label>
                                        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Decrypting…' : '🔓 Decrypt'}</button>
                                    </>
                                )}
                                {decrypted && info.permission === 'download' && <button type="button" className="btn btn-primary w-full" onClick={() => saveBytes(decrypted.data, decrypted.name, decrypted.mimetype)}>⬇️ Save decrypted file</button>}
                                {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
                            </form>
                        ) : (
                        <form className="space-y-3" onSubmit={(e) => void open(e, false)}>
                            {info.requiresPassword && (
                                <label className="block"><span className="label">Password</span><input className="input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
                            )}
                            <div className="flex gap-2">
                                {info.permission === 'download' && <button className="btn btn-primary flex-1" disabled={busy}>⬇️ Download</button>}
                                {kind && kind !== 'text' && <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={(e) => void open(e as unknown as FormEvent, true)}>👁️ Preview</button>}
                            </div>
                            {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
                        </form>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
