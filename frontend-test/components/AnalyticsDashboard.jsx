'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, HardDrive, FileText, Download } from 'lucide-react';

export default function AnalyticsDashboard({ stats }) {
    const [timeRange, setTimeRange] = useState('7d');
    const [analyticsData, setAnalyticsData] = useState(null);

    useEffect(() => {
        // Mock analytics data - in production, fetch from API
        setAnalyticsData({
            uploadsOverTime: [
                { date: 'Mon', uploads: 12 },
                { date: 'Tue', uploads: 19 },
                { date: 'Wed', uploads: 15 },
                { date: 'Thu', uploads: 25 },
                { date: 'Fri', uploads: 22 },
                { date: 'Sat', uploads: 18 },
                { date: 'Sun', uploads: 14 }
            ],
            storageByCategory: [
                { name: 'Images', value: 45, color: '#3b82f6' },
                { name: 'Documents', value: 25, color: '#10b981' },
                { name: 'Videos', value: 20, color: '#f59e0b' },
                { name: 'Other', value: 10, color: '#6b7280' }
            ],
            topFiles: [
                { name: 'presentation.pdf', downloads: 45 },
                { name: 'photo.jpg', downloads: 38 },
                { name: 'report.docx', downloads: 32 },
                { name: 'video.mp4', downloads: 28 },
                { name: 'archive.zip', downloads: 24 }
            ]
        });
    }, [timeRange]);

    if (!analyticsData) return null;

    return (
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <TrendingUp className="w-6 h-6" />
                    Analytics Dashboard
                </h2>
                <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="90d">Last 90 days</option>
                </select>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sky-100 text-sm">Total Files</p>
                            <p className="text-3xl font-bold">{stats?.totalFiles || 0}</p>
                        </div>
                        <FileText className="w-10 h-10 opacity-80" />
                    </div>
                </div>
                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-green-100 text-sm">Storage Used</p>
                            <p className="text-3xl font-bold">{((stats?.totalSize || 0) / 1024 / 1024 / 1024).toFixed(2)} GB</p>
                        </div>
                        <HardDrive className="w-10 h-10 opacity-80" />
                    </div>
                </div>
                <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-purple-100 text-sm">Total Downloads</p>
                            <p className="text-3xl font-bold">1,234</p>
                        </div>
                        <Download className="w-10 h-10 opacity-80" />
                    </div>
                </div>
                <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-5 text-white">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-orange-100 text-sm">Upload Rate</p>
                            <p className="text-3xl font-bold">98.5%</p>
                        </div>
                        <TrendingUp className="w-10 h-10 opacity-80" />
                    </div>
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-50 rounded-xl p-5">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Uploads Over Time</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={analyticsData.uploadsOverTime}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="uploads" stroke="#3b82f6" strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                <div className="bg-gray-50 rounded-xl p-5">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Storage by Category</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie
                                data={analyticsData.storageByCategory}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                            >
                                {analyticsData.storageByCategory.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                ))}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Most Downloaded Files</h3>
                <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={analyticsData.topFiles}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="downloads" fill="#3b82f6" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
