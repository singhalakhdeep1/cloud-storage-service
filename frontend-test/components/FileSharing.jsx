'use client';

import { useState } from 'react';
import { Share2, Copy, Link as LinkIcon, Mail, Users, X } from 'lucide-react';

export default function FileSharing({ file }) {
    const [isOpen, setIsOpen] = useState(false);
    const [shareLink, setShareLink] = useState('');
    const [shareSettings, setShareSettings] = useState({
        isPublic: false,
        expires: false,
        expiryDate: '',
        password: false,
        passwordValue: ''
    });
    const [copied, setCopied] = useState(false);

    const generateShareLink = () => {
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/shared/${file._id}`;
        setShareLink(link);
    };

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleShare = async () => {
        // API call to update file sharing settings
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        
        try {
            const res = await fetch(`${API_URL}/files/${file._id}/share`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(shareSettings)
            });

            const data = await res.json();
            if (data.success) {
                generateShareLink();
            }
        } catch (error) {
            console.error('Share error:', error);
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => {
                    setIsOpen(true);
                    generateShareLink();
                }}
                className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white py-2 px-4 rounded-lg font-semibold transition-all"
            >
                <Share2 className="w-4 h-4" />
                Share
            </button>
        );
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Share2 className="w-6 h-6" />
                        Share File
                    </h2>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="space-y-4">
                    {/* Share Link */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Share Link</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={shareLink}
                                readOnly
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
                            />
                            <button
                                onClick={copyToClipboard}
                                className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white py-2 px-4 rounded-lg"
                            >
                                {copied ? <Copy className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    {/* Share Options */}
                    <div className="space-y-3 pt-4 border-t">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <LinkIcon className="w-5 h-5 text-gray-600" />
                                <span className="text-gray-700">Public Link</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareSettings.isPublic}
                                    onChange={(e) => setShareSettings({ ...shareSettings, isPublic: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                            </label>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Mail className="w-5 h-5 text-gray-600" />
                                <span className="text-gray-700">Password Protection</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareSettings.password}
                                    onChange={(e) => setShareSettings({ ...shareSettings, password: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                            </label>
                        </div>

                        {shareSettings.password && (
                            <input
                                type="password"
                                value={shareSettings.passwordValue}
                                onChange={(e) => setShareSettings({ ...shareSettings, passwordValue: e.target.value })}
                                placeholder="Enter password"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            />
                        )}

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-gray-600" />
                                <span className="text-gray-700">Expiry Date</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareSettings.expires}
                                    onChange={(e) => setShareSettings({ ...shareSettings, expires: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                            </label>
                        </div>

                        {shareSettings.expires && (
                            <input
                                type="date"
                                value={shareSettings.expiryDate}
                                onChange={(e) => setShareSettings({ ...shareSettings, expiryDate: e.target.value })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                            />
                        )}
                    </div>

                    <button
                        onClick={handleShare}
                        className="w-full bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 rounded-lg transition-all"
                    >
                        Update Share Settings
                    </button>
                </div>
            </div>
        </div>
    );
}
