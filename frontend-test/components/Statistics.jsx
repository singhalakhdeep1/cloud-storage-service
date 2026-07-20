export default function Statistics({ files, stats, formatFileSize }) {
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);

    return (
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <h2 className="text-2xl font-bold mb-5 text-gray-800">📊 Storage Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <div className="bg-gray-50 rounded-xl p-5 text-center">
                    <div className="text-3xl font-bold text-sky-500">{files.length}</div>
                    <div className="text-sm text-gray-600 mt-2">Total Files</div>
                </div>
                <div className="bg-gray-50 rounded-xl p-5 text-center">
                    <div className="text-3xl font-bold text-sky-500">{formatFileSize(totalSize)}</div>
                    <div className="text-sm text-gray-600 mt-2">Total Size</div>
                </div>
                {stats && stats.byCategory && stats.byCategory.map((stat) => (
                    <div key={stat._id} className="bg-gray-50 rounded-xl p-5 text-center">
                        <div className="text-3xl font-bold text-sky-500">{stat.count}</div>
                        <div className="text-sm text-gray-600 mt-2">{stat._id}s</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
