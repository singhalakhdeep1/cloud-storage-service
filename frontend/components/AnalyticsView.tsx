'use client';

import { sdk } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { Spinner, useAsync } from './ui';

interface Dashboard {
    overview: { totalFiles: number; totalSize: number; avgFileSize: number; trashedFiles: number; storageUsed: number; storageLimit: number };
    typeDistribution: { type: string; count: number; size: number }[];
    categoryBreakdown: { category: string; count: number; size: number }[];
    uploadsOverTime: { date: string; uploads: number; size: number }[];
    topFiles: { _id: string; originalName: string; downloadCount: number; size: number }[];
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="card p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
            {hint && <div className="text-xs text-slate-500">{hint}</div>}
        </div>
    );
}

export function BarChart({ data, label }: { data: { key: string; value: number; title: string }[]; label: string }) {
    const max = Math.max(1, ...data.map((d) => d.value));
    return (
        <svg viewBox={`0 0 ${data.length * 12} 100`} className="h-40 w-full" role="img" aria-label={label} preserveAspectRatio="none">
            {data.map((d, i) => {
                const h = (d.value / max) * 90;
                return (
                    <rect key={d.key} x={i * 12 + 1} y={100 - h} width={10} height={Math.max(h, d.value ? 2 : 0.5)} rx={1} className={d.value ? 'fill-brand-500' : 'fill-slate-200'}>
                        <title>{d.title}</title>
                    </rect>
                );
            })}
        </svg>
    );
}

export default function AnalyticsView() {
    const { data, loading, error } = useAsync(async () => (await sdk.analytics()).data as unknown as Dashboard, []);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>;
    const o = data.overview;
    const totalCat = Math.max(1, data.categoryBreakdown.reduce((n, c) => n + c.size, 0));
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Files" value={String(o.totalFiles)} hint={o.trashedFiles ? `${o.trashedFiles} in trash` : undefined} />
                <Stat label="Total size" value={formatBytes(o.totalSize)} />
                <Stat label="Average file" value={formatBytes(o.avgFileSize)} />
                <Stat label="Storage used" value={`${Math.round((o.storageUsed / Math.max(1, o.storageLimit)) * 100)}%`} hint={`${formatBytes(o.storageUsed)} of ${formatBytes(o.storageLimit)}`} />
            </div>

            <section className="card p-4">
                <h2 className="mb-2 font-semibold">Uploads in the last 30 days</h2>
                <BarChart label="Uploads per day" data={data.uploadsOverTime.map((d) => ({ key: d.date, value: d.uploads, title: `${d.date}: ${d.uploads} upload${d.uploads === 1 ? '' : 's'}, ${formatBytes(d.size)}` }))} />
                <div className="flex justify-between text-xs text-slate-500"><span>{data.uploadsOverTime[0]?.date}</span><span>{data.uploadsOverTime.at(-1)?.date}</span></div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className="card p-4">
                    <h2 className="mb-3 font-semibold">By category</h2>
                    {data.categoryBreakdown.length === 0 ? <p className="text-sm text-slate-500">No files yet.</p> : (
                        <ul className="space-y-3" data-testid="category-list">
                            {data.categoryBreakdown.map((c) => (
                                <li key={c.category}>
                                    <div className="mb-1 flex justify-between text-sm"><span className="capitalize">{c.category}</span><span className="text-slate-500">{c.count} · {formatBytes(c.size)}</span></div>
                                    <div className="h-2 rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(c.size / totalCat) * 100}%` }} /></div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                <section className="card p-4">
                    <h2 className="mb-3 font-semibold">Most downloaded</h2>
                    {data.topFiles.every((f) => !f.downloadCount) ? <p className="text-sm text-slate-500">Nothing downloaded yet.</p> : (
                        <ol className="space-y-2 text-sm">
                            {data.topFiles.filter((f) => f.downloadCount).map((f) => (<li key={f._id} className="flex justify-between gap-2"><span className="truncate">{f.originalName}</span><span className="shrink-0 text-slate-500">{f.downloadCount}×</span></li>))}
                        </ol>
                    )}
                </section>
            </div>

            <section className="card p-4">
                <h2 className="mb-3 font-semibold">File types</h2>
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Type</th><th>Files</th><th>Size</th></tr></thead><tbody>
                    {data.typeDistribution.map((t) => (<tr key={t.type} className="border-t border-slate-100"><td className="py-1.5">{t.type}</td><td>{t.count}</td><td>{formatBytes(t.size)}</td></tr>))}
                </tbody></table></div>
            </section>
        </div>
    );
}
