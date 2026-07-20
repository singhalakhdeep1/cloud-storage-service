'use client';

import { useState, useEffect, useRef } from 'react';
import Header from '@/components/Header';
import Message from '@/components/Message';
import Statistics from '@/components/Statistics';
import UploadZone from '@/components/UploadZone';
import Controls from '@/components/Controls';
import FileList from '@/components/FileList';
import Features from '@/components/Features';

export default function FileUploadApp() {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState({});
    const [stats, setStats] = useState(null);
    const [message, setMessage] = useState(null);
    const [filter, setFilter] = useState('all');
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

    const showMessage = (msg, type = 'success') => {
        setMessage({ text: msg, type });
        setTimeout(() => setMessage(null), 5000);
    };

    const fetchFiles = async () => {
        setLoading((prev) => ({ ...prev, fetch: true }));
        try {
            const params = new URLSearchParams();
            if (filter !== 'all') params.append('category', filter);

            const res = await fetch(`${API_URL}/files?${params}`);
            const data = await res.json();
            setFiles(data.data?.files || []);
        } catch (error) {
            showMessage('Error fetching files', 'error');
        } finally {
            setLoading((prev) => ({ ...prev, fetch: false }));
        }
    };

    const fetchStats = async () => {
        try {
            const res = await fetch(`${API_URL}/files/stats`);
            const data = await res.json();
            setStats(data.data);
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const uploadFile = async (file) => {
        const formData = new FormData();
        formData.append('file', file);

        setLoading((prev) => ({ ...prev, upload: true }));
        try {
            const res = await fetch(`${API_URL}/files/upload`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (data.success) {
                showMessage('File uploaded successfully!');
                fetchFiles();
                fetchStats();
            } else {
                showMessage(data.message || 'Upload failed', 'error');
            }
        } catch (error) {
            showMessage('Error uploading file', 'error');
        } finally {
            setLoading((prev) => ({ ...prev, upload: false }));
        }
    };

    const uploadMultiple = async (fileList) => {
        const formData = new FormData();
        Array.from(fileList).forEach((file) => {
            formData.append('files', file);
        });

        setLoading((prev) => ({ ...prev, upload: true }));
        try {
            const res = await fetch(`${API_URL}/files/upload-multiple`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (data.success) {
                showMessage(`${data.count} files uploaded successfully!`);
                fetchFiles();
                fetchStats();
            } else {
                showMessage('Upload failed', 'error');
            }
        } catch (error) {
            showMessage('Error uploading files', 'error');
        } finally {
            setLoading((prev) => ({ ...prev, upload: false }));
        }
    };

    const downloadFile = async (id) => {
        try {
            const res = await fetch(`${API_URL}/files/${id}/download`);
            const data = await res.json();
            if (data.success) {
                window.open(data.url, '_blank');
            }
        } catch (error) {
            showMessage('Error downloading file', 'error');
        }
    };

    const deleteFile = async (id) => {
        if (!confirm('Delete this file?')) return;

        setLoading((prev) => ({ ...prev, delete: true }));
        try {
            const res = await fetch(`${API_URL}/files/${id}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (data.success) {
                showMessage('File deleted successfully');
                fetchFiles();
                fetchStats();
            }
        } catch (error) {
            showMessage('Error deleting file', 'error');
        } finally {
            setLoading((prev) => ({ ...prev, delete: false }));
        }
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            if (e.dataTransfer.files.length === 1) {
                uploadFile(e.dataTransfer.files[0]);
            } else {
                uploadMultiple(e.dataTransfer.files);
            }
        }
    };

    const handleFileSelect = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            if (e.target.files.length === 1) {
                uploadFile(e.target.files[0]);
            } else {
                uploadMultiple(e.target.files);
            }
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getFileIcon = (category) => {
        const icons = {
            image: '🖼️',
            video: '🎬',
            document: '📄',
            audio: '🎵',
            other: '📁'
        };
        return icons[category] || icons.other;
    };

    useEffect(() => {
        fetchFiles();
        fetchStats();
    }, [filter]);

    return (
        <div className="max-w-6xl mx-auto px-5 py-10">
            <Header />
            <Message message={message} />
            <Statistics files={files} stats={stats} formatFileSize={formatFileSize} />
            <UploadZone 
                dragActive={dragActive}
                onDrag={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                fileInputRef={fileInputRef}
                onFileSelect={handleFileSelect}
            />
            <Controls 
                filter={filter}
                setFilter={setFilter}
                onRefresh={fetchFiles}
                loading={loading.fetch}
            />
            <FileList 
                files={files}
                onDownload={downloadFile}
                onDelete={deleteFile}
                formatFileSize={formatFileSize}
                getFileIcon={getFileIcon}
            />
            <Features />
        </div>
    );
}
