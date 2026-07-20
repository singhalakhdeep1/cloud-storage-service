import './globals.css';

export const metadata = {
    title: 'File Upload - Cloud Storage',
    description: 'File upload system with AWS S3, image processing, and streaming',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
