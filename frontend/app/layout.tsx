import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { SessionProvider } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
    title: 'Cloud Storage',
    description: 'Store, share and manage your files',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                <ToastProvider>
                    <SessionProvider>{children}</SessionProvider>
                </ToastProvider>
            </body>
        </html>
    );
}
