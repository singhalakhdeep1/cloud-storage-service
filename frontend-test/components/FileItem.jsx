import { format } from 'date-fns';

export default function FileItem({ file, onDownload, onDelete, formatFileSize, getFileIcon }) {
    const getFileIconClass = (category) => {
        const classes = {
            image: 'bg-blue-100 text-blue-800',
            video: 'bg-pink-100 text-pink-800',
            document: 'bg-yellow-100 text-yellow-800',
            audio: 'bg-green-100 text-green-800',
            other: 'bg-gray-100 text-gray-800'
        };
        return classes[category] || classes.other;
    };

    const getBadgeClass = (category) => {
        const classes = {
            image: 'bg-blue-100 text-blue-800',
            video: 'bg-pink-100 text-pink-800',
            document: 'bg-yellow-100 text-yellow-800',
            audio: 'bg-green-100 text-green-800',
            other: 'bg-gray-100 text-gray-800'
        };
        return classes[category] || classes.other;
    };

    return (
        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg mb-3 hover:bg-gray-100 transition-all">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${getFileIconClass(file.category)}`}>
                {getFileIcon(file.category)}
            </div>
            <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-base font-semibold text-gray-800">
                        {file.originalName}
                    </h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getBadgeClass(file.category)}`}>{file.category}</span>
                </div>
                <div className="flex gap-4 text-xs text-gray-600">
                    <span>📏 {formatFileSize(file.size)}</span>
                    <span>📅 {format(new Date(file.createdAt), 'MMM dd, yyyy')}</span>
                    <span>⬇️ {file.downloads} downloads</span>
                </div>
            </div>
            <div className="flex gap-2">
                <button onClick={() => onDownload(file._id)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-semibold transition-all">
                    ⬇️ Download
                </button>
                <button onClick={() => onDelete(file._id)} className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg font-semibold transition-all">
                    🗑️
                </button>
            </div>
        </div>
    );
}
