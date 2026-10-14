'use client';

import { useEffect, useState } from 'react';
import type { FileInfo } from '@sdk/index';
import { errorMessage, sdk } from '@/lib/api';
import { categoryIcon, previewKind } from '@/lib/format';
import { Spinner } from './ui';

/** Shows the file in the page when the browser can render it safely; the URL is short-lived and not counted as a download. */
export default function Preview({ file }: { file: FileInfo }) {
    const kind = previewKind(file.mimetype);
    const [url, setUrl] = useState<string | null>(null);
    const [text, setText] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setUrl(null);
        setText(null);
        setError(null);
        if (!kind) return;
        sdk.downloadUrl(file._id, { inline: true }).then(
            async ({ url: u }) => {
                if (!alive) return;
                if (kind === 'text') {
                    // only the first 200 KB: this is a preview, not an editor
                    const res = await fetch(u, { headers: { Range: 'bytes=0-204799' } });
                    if (alive) setText(await res.text());
                } else setUrl(u);
            },
            (e) => alive && setError(errorMessage(e))
        );
        return () => {
            alive = false;
        };
    }, [file._id, file.currentVersion, kind]);

    if (!kind) {
        return (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg bg-slate-100 text-slate-500">
                <span className="text-5xl" aria-hidden>{categoryIcon[file.category]}</span>
                <span className="text-sm">No preview for this type</span>
            </div>
        );
    }
    if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>;
    if (!url && text === null) return <Spinner label="Loading preview" />;

    return (
        <div className="overflow-hidden rounded-lg bg-slate-100" data-testid="preview">
            {kind === 'image' && url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={file.originalName} className="mx-auto max-h-96 object-contain" />
            )}
            {kind === 'video' && url && <video src={url} controls className="mx-auto max-h-96 w-full" preload="metadata" />}
            {kind === 'audio' && url && <audio src={url} controls className="w-full p-4" preload="metadata" />}
            {kind === 'pdf' && url && <iframe src={url} title={file.originalName} className="h-96 w-full bg-white" />}
            {kind === 'text' && text !== null && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-white p-3 text-xs">{text}</pre>}
        </div>
    );
}
