'use client';

import { useState } from 'react';
import { Upload, Pause, Play, X, CheckCircle, AlertCircle } from 'lucide-react';

export default function ChunkedUpload({ onUploadComplete }) {
    const [file, setFile] = useState(null);
    const [uploadId, setUploadId] = useState(null);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('idle'); // idle, uploading, paused, completed, error
    const [error, setError] = useState('');

    const initiateUpload = async () => {
        if (!file) return;

        setStatus('uploading');
        setError('');

        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        const chunkSize = 5 * 1024 * 1024; // 5MB chunks

        try {
            // Initiate chunked upload
            const initRes = await fetch(`${API_URL}/upload/chunked`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    filename: file.name,
                    originalName: file.name,
                    mimeType: file.type,
                    totalSize: file.size,
                    chunkSize
                })
            });

            const initData = await initRes.json();
            if (initData.success) {
                setUploadId(initData.data.uploadId);
                await uploadChunks(initData.data.uploadId, initData.data.totalChunks, chunkSize);
            } else {
                setError(initData.error || 'Failed to initiate upload');
                setStatus('error');
            }
        } catch (err) {
            setError('Connection error');
            setStatus('error');
        }
    };

    const uploadChunks = async (uploadId, totalChunks, chunkSize) => {
        const chunks = Math.ceil(file.size / chunkSize);
        let uploadedChunks = 0;

        for (let i = 0; i < chunks; i++) {
            if (status === 'paused') break;

            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);

            const formData = new FormData();
            formData.append('chunk', chunk);
            formData.append('chunkNumber', i);

            const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

            try {
                const res = await fetch(`${API_URL}/upload/chunked/${uploadId}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });

                const data = await res.json();
                if (data.success) {
                    uploadedChunks++;
                    setProgress((uploadedChunks / totalChunks) * 100);
                }
            } catch (err) {
                setError(`Chunk ${i + 1} failed`);
                setStatus('error');
                return;
            }
        }

        if (uploadedChunks === totalChunks) {
            await completeUpload(uploadId);
        }
    };

    const completeUpload = async (uploadId) => {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

        try {
            const res = await fetch(`${API_URL}/upload/chunked/${uploadId}/complete`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });

            const data = await res.json();
            if (data.success) {
                setStatus('completed');
                onUploadComplete && onUploadComplete(data.data);
            } else {
                setError(data.error || 'Failed to complete upload');
                setStatus('error');
            }
        } catch (err) {
            setError('Connection error');
            setStatus('error');
        }
    };

    const cancelUpload = async () => {
        if (!uploadId) {
            setStatus('idle');
            setFile(null);
            setProgress(0);
            return;
        }

        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

        try {
            await fetch(`${API_URL}/upload/chunked/${uploadId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
        } catch (err) {
            console.error('Cancel error:', err);
        }

        setStatus('idle');
        setFile(null);
        setUploadId(null);
        setProgress(0);
    };

    const handleFileSelect = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            setStatus('idle');
            setProgress(0);
            setError('');
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <h2 className="text-2xl font-bold mb-5 text-gray-800 flex items-center gap-2">
                <Upload className="w-6 h-6" />
                Chunked Upload
            </h2>

            {!file ? (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-sky-500 hover:bg-sky-50 transition-all">
                    <input
                        type="file"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="chunked-file-input"
                    />
                    <label htmlFor="chunked-file-input" className="cursor-pointer">
                        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <p className="text-gray-600 mb-2">Select a large file for chunked upload</p>
                        <p className="text-sm text-gray-400">Recommended for files larger than 10MB</p>
                    </label>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <Upload className="w-8 h-8 text-sky-500" />
                            <div>
                                <p className="font-semibold text-gray-800">{file.name}</p>
                                <p className="text-sm text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setFile(null)}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {status === 'idle' && (
                        <button
                            onClick={initiateUpload}
                            className="w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 rounded-lg transition-all"
                        >
                            Start Upload
                        </button>
                    )}

                    {status === 'uploading' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setStatus('paused')}
                                    className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-4 rounded-lg"
                                >
                                    <Pause className="w-4 h-4" />
                                    Pause
                                </button>
                                <button
                                    onClick={cancelUpload}
                                    className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg"
                                >
                                    <X className="w-4 h-4" />
                                    Cancel
                                </button>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                                <div
                                    className="bg-sky-500 h-3 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="text-center text-sm text-gray-600">{Math.round(progress)}% complete</p>
                        </div>
                    )}

                    {status === 'paused' && (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setStatus('uploading')}
                                className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded-lg"
                            >
                                <Play className="w-4 h-4" />
                                Resume
                            </button>
                            <button
                                onClick={cancelUpload}
                                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg"
                            >
                                <X className="w-4 h-4" />
                                Cancel
                            </button>
                        </div>
                    )}

                    {status === 'completed' && (
                        <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-lg">
                            <CheckCircle className="w-5 h-5" />
                            <span className="font-semibold">Upload completed successfully!</span>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-lg">
                                <AlertCircle className="w-5 h-5" />
                                <span className="font-semibold">{error}</span>
                            </div>
                            <button
                                onClick={initiateUpload}
                                className="w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 rounded-lg"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
