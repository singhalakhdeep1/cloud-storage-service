'use client';

import { sdk, errorMessage } from '@/lib/api';
import { categoryIcon, formatBytes, formatDate } from '@/lib/format';
import { Empty, Spinner, useAsync, useToast } from './ui';

export default function TrashView({ onChanged }: { onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const { data, loading, error, reload } = useAsync(() => sdk.listTrash(), []);

    async function act(label: string, fn: () => Promise<unknown>) {
        try {
            await fn();
            toast(label);
            reload();
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    if (loading && !data) return <Spinner />;
    if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>;
    const files = data?.files ?? [];
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600">Files stay here for {data?.retentionDays} days, then they are deleted for good. They still use storage space until then.</p>
                {files.length > 0 && (
                    <button className="btn btn-danger" onClick={async () => { if (await confirm(`Delete ${files.length} file${files.length > 1 ? 's' : ''} for good? This cannot be undone.`, { danger: true, confirmLabel: 'Empty trash' })) await act('Trash emptied', () => sdk.emptyTrash()); }}>Empty trash</button>
                )}
            </div>
            {files.length === 0 ? (
                <Empty icon="🗑️" title="The trash is empty" />
            ) : (
                <ul className="card divide-y divide-slate-100" data-testid="trash-list">
                    {files.map((f) => (
                        <li key={f._id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                            <div className="flex items-center gap-3">
                                <span className="text-2xl" aria-hidden>{categoryIcon[f.category]}</span>
                                <div>
                                    <div className="font-medium">{f.originalName}</div>
                                    <div className="text-xs text-slate-500">{formatBytes(f.size)} · deleted {formatDate(f.deletedAt)}</div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button className="btn btn-secondary" onClick={() => void act('File restored', () => sdk.restore(f._id))}>Restore</button>
                                <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm(`Delete “${f.originalName}” for good?`, { danger: true, confirmLabel: 'Delete' })) await act('Deleted', () => sdk.delete(f._id)); }}>Delete forever</button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
