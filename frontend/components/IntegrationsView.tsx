'use client';

import { useState } from 'react';
import { errorMessage, sdk } from '@/lib/api';
import { copyText, timeAgo } from '@/lib/format';
import { Badge, Field, Spinner, useAsync, useToast } from './ui';

type Type = 'slack' | 'dropbox' | 'google-drive';
const SERVICES: { type: Type; key: string; title: string; icon: string; fields: ('webhookUrl' | 'accessToken' | 'folderId')[]; hint: string }[] = [
    { type: 'slack', key: 'slack', title: 'Slack', icon: '💬', fields: ['webhookUrl'], hint: 'An incoming-webhook URL from your Slack workspace' },
    { type: 'dropbox', key: 'dropbox', title: 'Dropbox', icon: '📦', fields: ['accessToken'], hint: 'An access token for your Dropbox app' },
    { type: 'google-drive', key: 'googleDrive', title: 'Google Drive', icon: '🟢', fields: ['accessToken', 'folderId'], hint: 'An OAuth access token with the Drive file scope; the folder id is optional' },
];
const LABELS = { webhookUrl: 'Webhook URL', accessToken: 'Access token', folderId: 'Default folder id (optional)' } as const;

function Connection({ service, state, onChanged }: { service: (typeof SERVICES)[number]; state?: { configured: boolean; status: string; lastError?: string; lastUsedAt?: string }; onChanged: () => void }) {
    const { toast, confirm } = useToast();
    const [values, setValues] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState(false);

    async function save() {
        setBusy(true);
        try {
            await sdk.connectIntegration(service.type, values);
            toast(`${service.title} connected`);
            setValues({});
            setEditing(false);
            onChanged();
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="card p-4" aria-label={service.title}>
            <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold"><span aria-hidden>{service.icon}</span>{service.title}</h3>
                <Badge tone={state?.configured ? (state.status === 'error' ? 'red' : 'green') : 'slate'}>{state?.configured ? state.status : 'not connected'}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">{service.hint}</p>
            {state?.lastError && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">Last error: {state.lastError}</p>}
            {state?.lastUsedAt && <p className="mt-1 text-xs text-slate-500">Last used {timeAgo(state.lastUsedAt)}</p>}
            {(!state?.configured || editing) && (
                <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                    {service.fields.map((f) => (
                        <Field key={f} label={LABELS[f]}>
                            <input className="input" type={f === 'accessToken' ? 'password' : 'text'} autoComplete="off" required={f !== 'folderId'} value={values[f] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />
                        </Field>
                    ))}
                    <div className="flex gap-2">
                        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Connect'}</button>
                        {editing && <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>}
                    </div>
                </form>
            )}
            {state?.configured && !editing && (
                <div className="mt-3 flex gap-2">
                    <button className="btn btn-secondary" onClick={() => setEditing(true)}>Replace credentials</button>
                    <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm(`Disconnect ${service.title}?`, { danger: true, confirmLabel: 'Disconnect' })) { try { await sdk.disconnectIntegration(service.type); toast('Disconnected'); onChanged(); } catch (e) { toast(errorMessage(e), 'error'); } } }}>Disconnect</button>
                </div>
            )}
        </section>
    );
}

function Webhooks() {
    const { toast, confirm } = useToast();
    const { data, loading, reload } = useAsync(() => sdk.webhooks(), []);
    const [url, setUrl] = useState('');
    const [events, setEvents] = useState<string[]>([]);
    const [secret, setSecret] = useState<string | null>(null);
    const [deliveries, setDeliveries] = useState<{ id: string; rows: Awaited<ReturnType<typeof sdk.webhookDeliveries>>['data'] } | null>(null);

    async function create() {
        try {
            const r = await sdk.createWebhook(url, events.length ? events : ['*']);
            setSecret(r.data.secret);
            setUrl('');
            setEvents([]);
            reload();
        } catch (e) {
            toast(errorMessage(e), 'error');
        }
    }

    return (
        <section className="card p-4" aria-label="Webhooks">
            <h3 className="font-semibold">Webhooks</h3>
            <p className="mb-3 text-sm text-slate-500">We POST a signed JSON event to your URL when something happens to your files (header <code>X-Webhook-Signature: t=…,v1=HMAC-SHA256(t.body)</code>). Failed deliveries are retried.</p>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
                <Field label="Endpoint URL"><input className="input" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/files" /></Field>
                <fieldset>
                    <legend className="label">Events (none selected = all)</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {(data?.events ?? []).map((ev) => (
                            <label key={ev} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((l) => (l.includes(ev) ? l.filter((x) => x !== ev) : [...l, ev]))} />{ev}</label>
                        ))}
                    </div>
                </fieldset>
                <button className="btn btn-primary">Add webhook</button>
            </form>
            {secret && (
                <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm" data-testid="webhook-secret">
                    <div className="mb-1 font-medium text-emerald-800">Signing secret (shown once)</div>
                    <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={secret} onFocus={(e) => e.currentTarget.select()} aria-label="Signing secret" /><button className="btn btn-secondary" onClick={async () => toast((await copyText(secret)) ? 'Copied' : 'Select and copy it', 'info')}>Copy</button></div>
                </div>
            )}
            {loading && !data ? <Spinner /> : (
                <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200" data-testid="webhook-list">
                    {(data?.data ?? []).length === 0 && <li className="p-3 text-sm text-slate-500">No webhooks yet.</li>}
                    {(data?.data ?? []).map((w) => (
                        <li key={w.id} className="space-y-2 p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0"><div className="truncate font-medium">{w.url}</div><div className="text-xs text-slate-500">{w.events.join(', ')}</div></div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={w.isActive ? 'green' : 'red'}>{w.isActive ? 'active' : 'disabled'}</Badge>
                                    <button className="btn btn-secondary" onClick={async () => { try { const r = await sdk.testWebhook(w.id); toast(r.data.status === 'success' ? 'Test delivered' : `Test failed: ${r.data.error ?? r.data.statusCode}`, r.data.status === 'success' ? 'success' : 'error'); } catch (e) { toast(errorMessage(e), 'error'); } }}>Test</button>
                                    <button className="btn btn-secondary" onClick={async () => setDeliveries({ id: w.id, rows: (await sdk.webhookDeliveries(w.id)).data })}>Deliveries</button>
                                    <button className="btn btn-secondary" onClick={async () => { await sdk.updateWebhook(w.id, { isActive: !w.isActive }); reload(); }}>{w.isActive ? 'Disable' : 'Enable'}</button>
                                    <button className="btn btn-ghost text-red-600" onClick={async () => { if (await confirm('Delete this webhook?', { danger: true, confirmLabel: 'Delete' })) { await sdk.deleteWebhook(w.id); reload(); } }}>Delete</button>
                                </div>
                            </div>
                            {deliveries?.id === w.id && (
                                <ul className="rounded bg-slate-50 p-2 text-xs">
                                    {deliveries.rows.length === 0 && <li>No deliveries yet.</li>}
                                    {deliveries.rows.map((d) => (<li key={d._id} className="flex justify-between gap-2 py-0.5"><span>{d.event}</span><span>{d.status}{d.statusCode ? ` (${d.statusCode})` : ''} · attempt {d.attempt} · {timeAgo(d.createdAt)}</span></li>))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export default function IntegrationsView() {
    const status = useAsync(() => sdk.integrations(), []);
    if (status.loading && !status.data) return <Spinner />;
    return (
        <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
                {SERVICES.map((s) => (<Connection key={s.type} service={s} state={status.data?.integrations[s.key]} onChanged={status.reload} />))}
            </div>
            <Webhooks />
        </div>
    );
}
