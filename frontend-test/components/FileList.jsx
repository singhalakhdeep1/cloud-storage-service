import FileItem from './FileItem';

export default function FileList({ files, onDownload, onDelete, formatFileSize, getFileIcon }) {
    if (files.length === 0) {
        return (
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
                <h2 className="text-2xl font-bold mb-5 text-gray-800">📁 Files (0)</h2>
                <div className="text-center py-16 text-gray-400">
                    <div className="text-6xl mb-4">📭</div>
                    <h3 className="text-xl mb-2">No files yet</h3>
                    <p>Upload your first file to get started!</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <h2 className="text-2xl font-bold mb-5 text-gray-800">📁 Files ({files.length})</h2>
            <div>
                {files.map((file) => (
                    <FileItem
                        key={file._id}
                        file={file}
                        onDownload={onDownload}
                        onDelete={onDelete}
                        formatFileSize={formatFileSize}
                        getFileIcon={getFileIcon}
                    />
                ))}
            </div>
        </div>
    );
}
