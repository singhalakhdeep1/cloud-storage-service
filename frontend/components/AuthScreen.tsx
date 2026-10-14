'use client';

import { useState, type FormEvent } from 'react';
import { errorMessage, FileCloudError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Field } from './ui';

export default function AuthScreen() {
    const { signIn, signUp } = useSession();
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    async function submit(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setFieldErrors({});
        try {
            if (mode === 'login') await signIn(email, password);
            else await signUp(name, email, password);
        } catch (err) {
            setError(errorMessage(err));
            if (err instanceof FileCloudError && err.errors) setFieldErrors(Object.fromEntries(err.errors.map((x) => [x.field, x.message])));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 to-slate-900 p-4">
            <div className="card w-full max-w-md p-8">
                <div className="mb-6 text-center">
                    <div className="text-4xl" aria-hidden>☁️</div>
                    <h1 className="mt-2 text-2xl font-bold">Cloud Storage</h1>
                    <p className="text-sm text-slate-500">Store, share and manage your files</p>
                </div>

                <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-medium" role="tablist">
                    {(['login', 'register'] as const).map((m) => (
                        <button key={m} role="tab" aria-selected={mode === m} className={`rounded-md py-2 ${mode === m ? 'bg-white shadow-sm' : 'text-slate-500'}`} onClick={() => { setMode(m); setError(null); setFieldErrors({}); }} type="button">
                            {m === 'login' ? 'Sign in' : 'Create account'}
                        </button>
                    ))}
                </div>

                <form onSubmit={submit} className="space-y-4" noValidate>
                    {mode === 'register' && (
                        <Field label="Name" hint={fieldErrors.name}>
                            <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
                        </Field>
                    )}
                    <Field label="Email" hint={fieldErrors.email}>
                        <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </Field>
                    <Field label="Password" hint={fieldErrors.password ?? (mode === 'register' ? 'At least 8 characters with a letter and a digit' : undefined)}>
                        <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </Field>
                    {error && !Object.keys(fieldErrors).length && (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
                    )}
                    <button className="btn btn-primary w-full" disabled={busy} type="submit">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
                </form>
            </div>
        </main>
    );
}
