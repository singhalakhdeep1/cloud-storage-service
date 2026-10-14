'use client';

import { useState, type FormEvent } from 'react';
import { errorMessage, persistToken, sdk } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Field, Spinner, useAsync, useToast } from './ui';

export default function SettingsView() {
    const { user, setUser, signOut } = useSession();
    const { toast, confirm } = useToast();
    const caps = useAsync(() => sdk.capabilities(), []);
    const [name, setName] = useState(user?.name ?? '');
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [deletePw, setDeletePw] = useState('');
    const [busy, setBusy] = useState('');

    if (!user || (caps.loading && !caps.data)) return <Spinner />;
    const c = caps.data;
    const prefs = user.preferences;

    async function run(key: string, fn: () => Promise<void>) {
        setBusy(key);
        try {
            await fn();
        } catch (e) {
            toast(errorMessage(e), 'error');
        } finally {
            setBusy('');
        }
    }

    // shown at once, then confirmed by the server (and put back if it refuses)
    const savePrefs = async (patch: { defaultStorage?: string | null; autoProcessImages?: boolean; encryptFiles?: boolean }) => {
        const before = user;
        setUser({ ...user, preferences: { ...user.preferences, ...patch, defaultStorage: patch.defaultStorage === undefined ? user.preferences.defaultStorage : patch.defaultStorage ?? undefined } });
        setBusy('prefs');
        try {
            setUser(await sdk.updateProfile({ preferences: patch }));
            toast('Preferences saved');
        } catch (e) {
            setUser(before);
            toast(errorMessage(e), 'error');
        } finally {
            setBusy('');
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <section className="card p-5">
                <h2 className="mb-3 font-semibold">Profile</h2>
                <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('profile', async () => { setUser(await sdk.updateProfile({ name })); toast('Profile saved'); }); }}>
                    <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={50} required /></Field>
                    <Field label="Email"><input className="input" value={user.email} disabled /></Field>
                    <p className="text-sm text-slate-500">Using {formatBytes(user.storageUsed)} of {formatBytes(user.storageLimit)} · {user.fileCount} files · role {user.role}</p>
                    <button className="btn btn-primary" disabled={busy === 'profile'}>Save</button>
                </form>
            </section>

            <section className="card p-5">
                <h2 className="mb-3 font-semibold">Storage</h2>
                <div className="space-y-4">
                    <Field label="Store new files on" hint="Existing files stay where they are">
                        <select className="input" value={prefs.defaultStorage ?? ''} onChange={(e) => void savePrefs({ defaultStorage: e.target.value || null })}>
                            <option value="">Server default ({c?.defaultProvider})</option>
                            {c?.providers.map((p) => (<option key={p} value={p}>{p}</option>))}
                        </select>
                    </Field>
                    <label className="flex items-start gap-3 text-sm">
                        <input type="checkbox" className="mt-1" checked={prefs.autoProcessImages} onChange={(e) => void savePrefs({ autoProcessImages: e.target.checked })} />
                        <span><strong>Make thumbnails for images</strong><br /><span className="text-slate-500">Used for the previews in your file list.</span></span>
                    </label>
                    <label className="flex items-start gap-3 text-sm">
                        <input type="checkbox" className="mt-1" checked={c?.encryption.forced || prefs.encryptFiles} disabled={!c?.encryption.available || c?.encryption.forced} onChange={(e) => void savePrefs({ encryptFiles: e.target.checked })} />
                        <span>
                            <strong>Encrypt new files at rest</strong>
                            <br />
                            <span className="text-slate-500">
                                {!c?.encryption.available ? 'Not set up on this server.' : c?.encryption.forced ? 'The administrator encrypts every file.' : 'AES-256-GCM. Encrypted files are decrypted by the server when you download them, so direct-to-storage uploads are not used.'}
                            </span>
                        </span>
                    </label>
                    {c && <p className="text-xs text-slate-500">Limits: files up to {formatBytes(c.maxFileSize)} · {c.maxFileVersions} versions kept · trash kept {c.trashRetentionDays} days · virus scanning {c.virusScanning ? 'on' : 'off'}</p>}
                </div>
            </section>

            <section className="card p-5">
                <h2 className="mb-3 font-semibold">Password and sessions</h2>
                <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void run('pw', async () => { await sdk.changePassword(current, next); persistToken(); setCurrent(''); setNext(''); toast('Password changed. Other devices were signed out.'); }); }}>
                    <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
                    <Field label="New password" hint="At least 8 characters with a letter and a digit"><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
                    <button className="btn btn-primary" disabled={busy === 'pw'}>Change password</button>
                </form>
                <div className="mt-4 border-t border-slate-100 pt-4">
                    <button className="btn btn-secondary" onClick={() => void run('all', async () => { await sdk.logoutEverywhere(); await signOut(); })}>Sign out on all devices</button>
                </div>
            </section>

            <section className="card border-red-200 p-5">
                <h2 className="mb-1 font-semibold text-red-700">Deactivate account</h2>
                <p className="mb-3 text-sm text-slate-500">You are signed out everywhere and can no longer sign in. Your files are kept until an administrator removes them.</p>
                <form className="flex items-end gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); void (async () => { if (!(await confirm('Deactivate your account?', { danger: true, confirmLabel: 'Deactivate' }))) return; await run('del', async () => { await sdk.deactivateAccount(deletePw); persistToken(); await signOut(); }); })(); }}>
                    <div className="flex-1"><Field label="Confirm with your password"><input className="input" type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} required /></Field></div>
                    <button className="btn btn-danger" disabled={busy === 'del'}>Deactivate</button>
                </form>
            </section>
        </div>
    );
}
