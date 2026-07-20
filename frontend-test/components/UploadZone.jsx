export default function UploadZone({ dragActive, onDrag, onDrop, onClick, fileInputRef, onFileSelect }) {
    return (
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <h2 className="text-2xl font-bold mb-5 text-gray-800">📤 Upload Files</h2>
            <div
                className={`border-3 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer transition-all ${dragActive ? 'border-sky-500 bg-sky-50' : 'hover:border-sky-500 hover:bg-sky-50'}`}
                onDragEnter={onDrag}
                onDragLeave={onDrag}
                onDragOver={onDrag}
                onDrop={onDrop}
                onClick={onClick}
            >
                <div className="text-5xl mb-4">☁️</div>
                <p className="text-base text-gray-600 mb-2">
                    Drag and drop files here, or click to select
                </p>
                <p className="text-sm text-gray-400">
                    Supports images, videos, documents, and audio files
                </p>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={onFileSelect}
                    className="hidden"
                />
            </div>
        </div>
    );
}
