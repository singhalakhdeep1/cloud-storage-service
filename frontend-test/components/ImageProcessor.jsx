'use client';

import { useState } from 'react';
import { Image as ImageIcon, Maximize2, Download, RefreshCw } from 'lucide-react';

export default function ImageProcessor({ file, onProcess }) {
    const [processing, setProcessing] = useState(false);
    const [operation, setOperation] = useState('');
    const [params, setParams] = useState({
        width: 800,
        height: 600,
        quality: 90,
        format: 'jpeg'
    });

    const handleProcess = async (op) => {
        setProcessing(true);
        setOperation(op);

        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
        let endpoint, body;

        switch (op) {
            case 'resize':
                endpoint = '/images/resize';
                body = { fileId: file._id, ...params };
                break;
            case 'thumbnail':
                endpoint = '/images/thumbnail';
                body = { fileId: file._id, ...params };
                break;
            case 'convert':
                endpoint = '/images/convert';
                body = { fileId: file._id, format: params.format };
                break;
            case 'compress':
                endpoint = '/images/compress';
                body = { fileId: file._id, quality: params.quality };
                break;
        }

        try {
            const res = await fetch(`${API_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            if (data.success) {
                onProcess && onProcess(data.data);
            }
        } catch (error) {
            console.error('Processing error:', error);
        } finally {
            setProcessing(false);
            setOperation('');
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-6">
            <h2 className="text-2xl font-bold mb-5 text-gray-800 flex items-center gap-2">
                <ImageIcon className="w-6 h-6" />
                Image Processing
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Width (px)</label>
                    <input
                        type="number"
                        value={params.width}
                        onChange={(e) => setParams({ ...params, width: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Height (px)</label>
                    <input
                        type="number"
                        value={params.height}
                        onChange={(e) => setParams({ ...params, height: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quality (%)</label>
                    <input
                        type="number"
                        min="1"
                        max="100"
                        value={params.quality}
                        onChange={(e) => setParams({ ...params, quality: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Format</label>
                    <select
                        value={params.format}
                        onChange={(e) => setParams({ ...params, format: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                        <option value="jpeg">JPEG</option>
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                        <option value="gif">GIF</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button
                    onClick={() => handleProcess('resize')}
                    disabled={processing}
                    className="flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white py-3 px-4 rounded-lg font-semibold transition-all"
                >
                    <Maximize2 className="w-4 h-4" />
                    {processing && operation === 'resize' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Resize'}
                </button>
                <button
                    onClick={() => handleProcess('thumbnail')}
                    disabled={processing}
                    className="flex items-center justify-center gap-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white py-3 px-4 rounded-lg font-semibold transition-all"
                >
                    <ImageIcon className="w-4 h-4" />
                    {processing && operation === 'thumbnail' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Thumbnail'}
                </button>
                <button
                    onClick={() => handleProcess('convert')}
                    disabled={processing}
                    className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white py-3 px-4 rounded-lg font-semibold transition-all"
                >
                    <RefreshCw className="w-4 h-4" />
                    {processing && operation === 'convert' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Convert'}
                </button>
                <button
                    onClick={() => handleProcess('compress')}
                    disabled={processing}
                    className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 px-4 rounded-lg font-semibold transition-all"
                >
                    <Download className="w-4 h-4" />
                    {processing && operation === 'compress' ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Compress'}
                </button>
            </div>
        </div>
    );
}
