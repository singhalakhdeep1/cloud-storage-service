'use client';

import AppShell from '@/components/AppShell';
import AuthScreen from '@/components/AuthScreen';
import { Spinner } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Home() {
    const { user, ready } = useSession();
    if (!ready) return <Spinner label="Starting" />;
    return user ? <AppShell /> : <AuthScreen />;
}
