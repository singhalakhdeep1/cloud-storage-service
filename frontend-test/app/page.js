'use client';

import { useState, useEffect, useRef } from 'react';
import Header from '@/components/Header';
import Message from '@/components/Message';
import Statistics from '@/components/Statistics';
import UploadZone from '@/components/UploadZone';
import Controls from '@/components/Controls';
import FileList from '@/components/FileList';
import Features from '@/components/Features';
import Auth from '@/components/Auth';
import ChunkedUpload from '@/components/ChunkedUpload';
import ImageProcessor from '@/components/ImageProcessor';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import IntegrationSettings from '@/components/IntegrationSettings';
import FileSharing from '@/components/FileSharing';
import { LogOut, Settings, BarChart3, Upload, Image as ImageIcon } from 'lucide-react';

export default function FileUploadApp() {
    const [user, setUser] = useState(null);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState({});
    const [stats, setStats] = useState(null);
    const [message, setMessage] = useState(null);
    const [filter, setFilter] = useState('all');
    const [dragActive, setDragActive] = useState(false);
    const [activeTab, setActiveTab] = useState('files');
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

    useEffect(() => {
        const token = localStorage.getItem('token');
        const savedUser = localStorage.getItem('user');
        if (token && savedUser) {
            setUser(JSON.parse(savedUser));
        }
    }, []);

    useEffect(() => {
        if (user) {
            fetchFiles();
            fetchStats();
        }
    }, [user, filter]);

    const handleAuthSuccess = (userData) => {
        setUser(userData);
        setActiveTab('files');
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
        setActiveTab('files');
    };

    const showMessage = (msg, type = 'success') => {
        setMessage({ text: msg, type });
        setTimeout(() => setMessage(null), 5000);
    };

    const fetchFiles = async () => {
        if (!user) return;
        
        setLoading((prev) => ({ ...prev, fetch: true }));
        try {
            const params = new URLSearchParams();
            if (filter !== 'all') params.append('category', filter);

            const res = await fetch(`${API_URL}/files?${params}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const data = await res.json();
            setFiles(data.data?.files || []);
        } catch (error) {
            showMessage('Error fetching files', 'error');
        } finally {
            setLoading((prev) => ({ ...prev, fetch: false }));
        }
    };

    const fetchStats = async () => {
        if (!user) return;
        
        try {
            const res = await fetch(`${API_URL}/files/stats`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
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
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
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
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
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
            const res = await fetch(`${API_URL}/files/${id}/download`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
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
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
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

    if (!user) {
        return <Auth onAuthSuccess={handleAuthSuccess} />;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Header user={user} onLogout={handleLogout} />
            
            <div className="max-w-6xl mx-auto px-5 py-10">
                <Message message={message} />
                
                {/* Navigation Tabs */}
                <div className="flex gap-2 mb-6 bg-white rounded-xl p-2 shadow-sm">
                    <button
                        onClick={() => setActiveTab('files')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                            activeTab === 'files' ? 'bg-sky-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        <Upload className="w-4 h-4" />
                        Files
                    </button>
                    <button
                        onClick={() => setActiveTab('chunked')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                            activeTab === 'chunked' ? 'bg-sky-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        <Upload className="w-4 h-4" />
                        Chunked Upload
                    </button>
                    <button
                        onClick={() => setActiveTab('image')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                            activeTab === 'image' ? 'bg-sky-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        <ImageIcon className="w-4 h-4" />
                        Image Processing
                    </button>
                    <button
                        onClick={() => setActiveTab('analytics')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                            activeTab === 'analytics' ? 'bg-sky-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        <BarChart3 className="w-4 h-4" />
                        Analytics
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
                            activeTab === 'settings' ? 'bg-sky-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                    >
                        <Settings className="w-4 h-4" />
                        Settings
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'files' && (
                    <>
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
                            onShare={(file) => setSelectedFile(file)}
                        />
                        <Features />
                    </>
                )}

                {activeTab === 'chunked' && (
                    <ChunkedUpload onUploadComplete={() => { fetchFiles(); fetchStats(); }} />
                )}

                {activeTab === 'image' && selectedFile && selectedFile.category === 'image' && (
                    <ImageProcessor file={selectedFile} onProcess={() => { fetchFiles(); }} />
                )}

                {activeTab === 'image' && (!selectedFile || selectedFile.category !== 'image') && (
                    <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
                        <ImageIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                        <h3 className="text-xl font-semibold text-gray-800 mb-2">Select an Image</h3>
                        <p className="text-gray-600">Go to the Files tab and select an image to process</p>
                    </div>
                )}

                {activeTab === 'analytics' && (
                    <AnalyticsDashboard stats={stats} />
                )}

                {activeTab === 'settings' && (
                    <IntegrationSettings />
                )}
            </div>

            {selectedFile && (
                <FileSharing file={selectedFile} />
            )}
        </div>
    );
}
